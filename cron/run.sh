#!/usr/bin/bash

set -e

if ! [ -d .iad ]; then
  git clone git@github.com:is-a-dev/register.git .iad
fi

if ! [ -d .data ]; then
  git clone git@github.com:dragsbruh/statistics.is-a.dev .data
  cd .data && git switch -C data && cd ..
fi

cd .iad && git pull && cd ..
cd .data && git pull && cd ..

bun start

cd .data && git add . && git commit -m "update $(date +%s)" && git push -u origin data && cd ..
