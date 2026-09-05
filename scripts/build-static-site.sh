#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="$PROJECT_DIR/dist"

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR/src"
cp -R "$PROJECT_DIR/apps/user-web/public/." "$OUTPUT_DIR/"
cp "$PROJECT_DIR/apps/user-web/src/app.js" "$OUTPUT_DIR/src/app.js"
cp "$PROJECT_DIR/apps/user-web/src/styles.css" "$OUTPUT_DIR/src/styles.css"
cp "$PROJECT_DIR/apps/user-web/src/retro-theme.css" "$OUTPUT_DIR/src/retro-theme.css"
cp "$PROJECT_DIR/apps/user-web/src/scroll-fab.js" "$OUTPUT_DIR/src/scroll-fab.js"

sed -i 's#\.\./src/#./src/#g' "$OUTPUT_DIR/index.html" "$OUTPUT_DIR/service-worker.js"
