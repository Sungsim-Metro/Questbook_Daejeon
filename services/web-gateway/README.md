# 웹 게이트웨이

웹 게이트웨이는 정적 파일 제공과 `/api` 프록시를 담당한다. 설계서의 웹 서버 계층에 해당한다.

## 예정 책임

- 사용자 웹, 파트너 웹, 관리자 웹 정적 파일 제공
- HTTPS, HSTS, 보안 헤더, 압축 설정
- `/api` 요청을 내부 앱 서버로 프록시
- 경로별 rate limit과 접근 정책
- NAVER Maps Dynamic Map에 필요한 공개 Key ID 전달

REST API secret 값은 이 계층에서도 파일로 보관하지 않고 배포 환경의 secret 주입을 사용한다.
