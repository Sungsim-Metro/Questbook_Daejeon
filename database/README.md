# 데이터베이스 디렉토리

PostgreSQL 마이그레이션과 기준 데이터를 보관한다. 운영 데이터베이스는 PostgreSQL로 확정하며, 현재 SQLite baseline 스키마는 PostgreSQL 마이그레이션으로 전환할 대상이다.

- `migrations/`: 사용자, 선호도, 퀘스트, 뱃지, 수첩, 파트너, 리워드 PostgreSQL 스키마 변경
- `seeds/`: `Category`, `BadgeDefinition`, `GgumdoriVariant` 같은 기준 데이터

한국관광공사 OpenAPI 원본 응답 전체, API Key, access token, secret 값은 이 디렉토리에 넣지 않는다.
