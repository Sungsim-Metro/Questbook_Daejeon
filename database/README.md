# 데이터베이스 디렉토리

관계형 데이터베이스 마이그레이션과 기준 데이터를 보관한다. 현재 단계에서는 PostgreSQL과 MySQL 중 특정 엔진을 고정하지 않고, 설계서의 논리 모델을 실제 스키마로 옮길 준비만 한다.

- `migrations/`: 사용자, 선호도, 퀘스트, 뱃지, 수첩, 파트너, 리워드 스키마 변경
- `seeds/`: `Category`, `BadgeDefinition`, `GgumdoriVariant` 같은 기준 데이터

한국관광공사 OpenAPI 원본 응답 전체, API Key, access token, secret 값은 이 디렉토리에 넣지 않는다.
