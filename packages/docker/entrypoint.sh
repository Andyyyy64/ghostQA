#!/bin/bash
set -e

# Start Xvfb (virtual framebuffer) for headless browser rendering
export DISPLAY=:99
Xvfb :99 -screen 0 1280x720x24 -nolisten tcp &
sleep 1

# Execute the provided command
exec "$@"
