# 사용자 웹/PWA

일반 사용자가 사용하는 모바일 웹 앱이다. `legacy/static-mvp/`에 아카이브된 정적 MVP 화면을 바로 이동하지 않고, 화면 단위로 복제하고 검증하면서 이 디렉토리로 옮긴다.

## 예정 책임

- 홈, 지도, 퀘스트, 탐험 노트, 뱃지, 꿈돌이 도감 화면
- Web App Manifest와 서비스워커
- 정적 자산 precache
- 마지막 추천 결과 runtime cache
- 위치 권한 요청과 사용자 동의 UI
- 한국관광공사 OpenAPI 데이터 표시 시 공공누리 출처표시

## 금지 경계

- NAVER Maps REST API Key, TourAPI Key, Gemini Key를 브라우저 코드에 넣지 않는다.
- 추천 점수 계산과 퀘스트 생성 기준 데이터를 클라이언트 정본으로 삼지 않는다.
