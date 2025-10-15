#!/bin/sh
set -eu

# Enable xtrace only if DEBUG=1 to reduce noise in prod
if [ "${DEBUG:-0}" = "1" ]; then
  set -x
fi

echo "start: launching listener"
exec node kb-job-listener.mjs

