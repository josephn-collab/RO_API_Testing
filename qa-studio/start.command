#!/bin/bash
# QA Studio launcher — double-click this file.
# Serves the PARENT "QA Assistant" folder so the page can read both qa-studio/openapi.json
# AND the sibling Knowledge/ files (embedded into the prompt). Opens the app at /qa-studio/.
# To stop: close this Terminal window.

cd "$(dirname "$0")/.." || exit 1   # serve the "QA Assistant" root (one level up from qa-studio)

PORT=8000
# find a free-ish port if 8000 is busy
if lsof -i :$PORT >/dev/null 2>&1; then PORT=8123; fi

echo "QA Studio running at http://localhost:$PORT/qa-studio/"
echo "Close this window to stop the server."

# open the browser after a short delay, then serve (foreground so closing the window stops it)
( sleep 1; open "http://localhost:$PORT/qa-studio/" ) &
python3 -m http.server "$PORT"
