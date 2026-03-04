#!/bin/bash
set -e

# Start Xvfb (virtual framebuffer) for headless browser rendering
export DISPLAY=:99
Xvfb :99 -screen 0 1280x720x24 -nolisten tcp &
sleep 1

# Start lightweight window manager for desktop mode
if [ "$GHOSTQA_DESKTOP" = "true" ]; then
  openbox &
  sleep 0.5
fi

# Execute the provided command
exec "$@"
