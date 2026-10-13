#!/bin/sh
# Serves the app on http://localhost:8000/ (needs Python 3). Ctrl+C to stop.
cd "$(dirname "$0")"
echo "RAM-GEAR change gear app: open http://localhost:8000/"
python3 -m http.server 8000 --bind 127.0.0.1
