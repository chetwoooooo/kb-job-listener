"filename": "start.sh", "language": "sh", "content": "#!/bin/sh\nset -eu\n# Enable xtrace only if DEBUG=1 to reduce noise in prod\nif [ "${DEBUG:-0}" = "1" ]; then\n set -x\nfi\necho "start: launching listener"\nexec node kb-job-listener.mjs\n"

