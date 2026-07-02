# 서비스 디렉토리

`services/`는 화면 앱 뒤에서 동작하는 서버 구성요소를 보관한다.

- `web-gateway/`: 정적 파일 제공, 보안 헤더, 압축, `/api` 프록시
- `app-api/`: Python 앱 서버, 추천·퀘스트·인증·뱃지·수첩·리워드 도메인

목표 구조는 `사용자 웹/PWA -> 웹 게이트웨이 -> 앱 API -> PostgreSQL/Redis/외부 API` 흐름이다.
