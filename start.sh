#!/bin/bash
# start.sh — startup script for Railway deployment

# Exit immediately if a command exits with a non-zero status
set -e

# Print each command before executing (useful for debugging)
set -x

# Run your Node.js app
exec node kb-job-listener.mjs