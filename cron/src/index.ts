import { readdir } from "fs/promises";
import { join, parse } from "path";
import { RecordType, z } from "zod";
import { parse as parseHTML } from "node-html-parser";

const DOMAIN_REGEX =
  /\b(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}\b/;
const DOMAINS_DIR = "./.iad/domains";
const REQUEST_CONCURRENCY = 10;

const domainSchema = z.object({
  owner: z.object({
    username: z.string(),
    // .. moar
  }),
  records: z.strictObject({
    A: z.array(z.string().ip()).optional(), // we dc about ipv4 specifically, i hope people arent stupid enough. i aint doing allat too.
    AAAA: z.array(z.string().ip()).optional(),
    CAA: z
      .array(
        z.strictObject({
          flags: z.number(),
          tag: z.string(),
          value: z.string(),
        })
      )
      .optional(),
    CNAME: z.string().regex(DOMAIN_REGEX).optional(),
    DS: z
      .array(
        z.strictObject({
          key_tag: z.number(),
          algorithm: z.number(),
          digest_type: z.number(),
          digest: z.string(),
        })
      )
      .optional(),
    MX: z
      .array(
        z.string().or(
          z
            .strictObject({
              target: z.string(),
              priority: z.number(),
            })
            .transform((o) => o.target)
        )
      )
      .optional(),
    NS: z.array(z.string().regex(DOMAIN_REGEX)).optional(),
    SRV: z
      .array(
        z.strictObject({
          priority: z.number(),
          weight: z.number(),
          port: z.number(),
          target: z.string().regex(DOMAIN_REGEX),
        })
      )
      .optional(),
    TLSA: z
      .array(
        z.strictObject({
          usage: z.number(),
          selector: z.number(),
          matching_type: z.number(),
          certificate: z.string(),
        })
      )
      .optional(),
    TXT: z.array(z.string()).or(z.string()).optional(),
    URL: z.string().url().optional(),
  }),
  proxied: z.boolean().optional(),
  description: z.string().optional(),
});

class FetchTimeoutError extends Error {
  constructor(url: string) {
    super(`[!] fetch timed out: ${url}`);
    this.name = "FetchTimeoutError";
  }
}

const allDomains = (
  await Promise.all(
    (
      await readdir(DOMAINS_DIR)
    )
      .filter((filename) => filename.endsWith(".json"))
      .map(
        (filename) =>
          new Promise<{
            data: z.infer<typeof domainSchema>;
            path: string;
            domain: string;
          }>((resolve) => {
            const path = join(DOMAINS_DIR, filename);
            Bun.file(path)
              .json()
              .then((data) => {
                resolve({
                  data,
                  path,
                  domain: filename.slice(0, -".json".length) + ".is-a.dev",
                });
              });
          })
      )
  )
).map((domain) => ({
  ...domain,
  data: domainSchema.parse(domain.data),
}));

console.log("ranking users on domains they own");
const usernamesRanked = Object.entries(
  allDomains.reduce((acc, cur) => {
    acc[cur.data.owner.username] = (acc[cur.data.owner.username] || 0) + 1;
    return acc;
  }, {} as Record<string, number>)
)
  .map(([username, count]) => ({ username, count }))
  .sort((a, b) => b.count - a.count);

console.log("ranking services by domains used for them");
const servicesRanked = Object.entries(
  allDomains.reduce((acc, cur) => {
    if (!cur.domain.startsWith("_")) {
      let service = "other";
      const cname = cur.data.records.CNAME?.toLowerCase();

      if (cname) {
        if (cname.endsWith(".github.io")) service = "github";
        else if (
          cname.endsWith(".vercel.app") ||
          cname === "cname.vercel-dns.com"
        )
          service = "vercel";
        else if (
          cname.endsWith(".netlify.app") ||
          cname.includes(".netlify.global") ||
          cname === "apex-loadbalancer.netlify.com"
        )
          service = "netlify";
        else if (cname.endsWith(".surge.sh")) service = "surge.sh";
        else if (
          cname.endsWith(".web.app") ||
          cname.endsWith(".firebaseapp.com")
        )
          service = "firebase";
        else if (cname.endsWith(".repl.co")) service = "replit";
        else if (cname.endsWith(".gitlab.io")) service = "gitlab";
        else if (cname.endsWith(".onrender.com")) service = "render";
        else if (
          cname.endsWith(".pages.dev") ||
          cname === "pages.cloudflare.com"
        )
          service = "cloudflare pages";
        else if (cname.endsWith(".glitch.me")) service = "glitch";
        else if (cname === "edge.redirect.pizza") service = "redirect.pizza";
        else if (cname.endsWith(".ondigitalocean.app"))
          service + "digital ocean";
        else if (cname === "hashnode.network") service = "hashnode";
        else if (cname.endsWith(".deno.dev")) service = "deno";
        else if (cname.endsWith(".streamlit.app")) service = "streamlit";
        else if (cname.endsWith(".gitbook.io")) service = "gitbook";
        else if (cname.endsWith(".codeberg.page")) service = "codeberg";
        else if (cname === "dns.nekoweb.org") service = "nekoweb.org";
        else if (cname === "readthedocs.io") service = "readthedocs";
      }

      acc[service] = (acc[service] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>)
)
  .map(([name, count]) => ({ name, count }))
  .sort((a, b) => b.count - a.count);

const siteSummaries: Record<
  string,
  {
    title: string;
    status: number; // 0 = unreachable
  }
> = {};

async function fetchTimeout(
  url: string,
  init?: RequestInit,
  timeout = 20_000,
  exit = false
): Promise<Response> {
  const controller = new AbortController();

  let resolveOuter: (value: Response) => void;
  let rejectOuter: (reason?: any) => void;
  const outer = new Promise<Response>((resolve, reject) => {
    resolveOuter = resolve;
    rejectOuter = reject;
  });

  const timeoutId = setTimeout(() => {
    controller.abort();
    rejectOuter(new FetchTimeoutError(url.toString()));
  }, timeout);

  fetch(url, { ...init, signal: controller.signal })
    .then((res) => {
      clearTimeout(timeoutId);
      resolveOuter(res);
    })
    .catch((err) => {
      clearTimeout(timeoutId);
      rejectOuter(err);
    });

  return outer;
}

console.log("getting site statuses");
const queue = allDomains.filter(
  (domain) =>
    domain.data.records.CNAME ||
    domain.data.records.A ||
    domain.data.records.AAAA // TODO: handle NS records
);
let failedQueue = new Set<string>();
const startTime = performance.now();

const totalSize = queue.length;
let activeWorkers = REQUEST_CONCURRENCY;
async function worker() {
  while (true) {
    const domain = queue.pop();
    if (!domain) {
      activeWorkers--;
      console.log(
        `[!] worker exiting (${activeWorkers} workers active other than me (${queue.length} queue items remaining))`
      );
      return;
    }

    let response: Response;
    try {
      response = await fetchTimeout(`https://${domain.domain}`);
      const body = await readResponseTruncated(response, 10_000);

      siteSummaries[domain.domain] = {
        title: parseHTML(body).querySelector("title")?.innerText ?? "no title",
        status: response.status,
      };
    } catch (e) {
      if (failedQueue.has(domain.domain)) {
        if (e instanceof FetchTimeoutError) console.warn(e.message);
        siteSummaries[domain.domain] = {
          title: e instanceof FetchTimeoutError ? "timeout" : "unreachable",
          status: 0,
        };
      } else {
        failedQueue.add(domain.domain);
        queue.push(domain);
        continue;
      }
    }

    const filled = Math.floor(((totalSize - queue.length) / totalSize) * 30);
    const pbar = `[${"*".repeat(filled)}${" ".repeat(30 - filled)}]`;
    console.log(
      `[*] ${pbar} (${
        queue.length + activeWorkers
      } remaining, total ${totalSize}, ETA: ${
        (((performance.now() - startTime) / (totalSize - queue.length)) *
          queue.length) /
        1000
      } seconds)`
    );
  }
}

await Promise.all(Array.from({ length: REQUEST_CONCURRENCY }, () => worker()));

process.stdout.clearLine(0);
process.stdout.cursorTo(0);
console.log("completed getting getting statuses");

const data = {
  servicesRanked,
  usernamesRanked,
  siteSummaries,
};
await Bun.file(".data/data.json").write(JSON.stringify(data));
console.log("wrote to data file");

async function readResponseTruncated(
  response: Response,
  limit = 1_000
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";

  let bytes = new Uint8Array();
  let total = 0;

  while (total < limit) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = value.slice(0, limit - total);
    const newBytes = new Uint8Array(total + chunk.length);
    newBytes.set(bytes, 0);
    newBytes.set(chunk, total);
    bytes = newBytes;
    total += chunk.length;
  }

  return new TextDecoder().decode(bytes);
}
