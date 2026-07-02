# baseline 기준 데이터

앱 API는 현재 로컬 baseline 실행 시 다음 기준 데이터를 PostgreSQL에 자동 seed한다.

- `Category`: `nature`, `science`, `downtown`, `market`, `mobility`, `nightview`
- `BadgeDefinition`: 카테고리별 1단계와 2단계 뱃지
- `GgumdoriVariant`: 뱃지 단계 조건으로 해금되는 꿈돌이 변형

한국관광공사 OpenAPI 원본 응답은 seed 데이터에 포함하지 않는다. 장소 후보는 앱 서버의 유저 단위 Redis 캐시에만 30분 TTL로 보관한다.
