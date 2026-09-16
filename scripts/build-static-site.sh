#!/usr/bin/env bash
# main 사용자 UI의 모든 스크립트와 테마를 정적 배포 디렉터리에 복사한다.
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_DIR="$PROJECT_DIR/dist"

rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR/src"
cp -R "$PROJECT_DIR/apps/user-web/public/." "$OUTPUT_DIR/"
# HTML과 모듈 import가 참조하는 테마와 연출 파일을 함께 복사한다.
cp -R "$PROJECT_DIR/apps/user-web/src/." "$OUTPUT_DIR/src/"

sed -i 's#\.\./src/#./src/#g' "$OUTPUT_DIR/index.html" "$OUTPUT_DIR/service-worker.js"
