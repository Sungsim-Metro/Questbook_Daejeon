#!/bin/sh
# 스모크 테스트용 questbook_test 데이터베이스를 생성한다.
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -c "CREATE DATABASE questbook_test OWNER \"$POSTGRES_USER\";"
