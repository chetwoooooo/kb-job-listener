#!/bin/sh
set -e  # exit on error

# Enable xtrace only if DEBUG=1
if [ "${DEBUG:-0}" = "1" ]; then
  set -x
fi

echo "start: launching listener"
exec node kb-job-listener.mjs
