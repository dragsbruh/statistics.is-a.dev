#!/usr/bin/bash

set -e

if ! [ -d .iad ]; then
  git clone git@github.com:is-a-dev/register.git .iad
fi

if ! [ -d .data ]; then
  git clone git@github.com:dragsbruh/statistics.is-a.dev .data
  cd .data && git switch -C data
fi 

cd .iad && git pull
cd .data && git pull
