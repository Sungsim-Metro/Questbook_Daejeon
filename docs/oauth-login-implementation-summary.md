# OAuth 로그인 구현 정리

작성일: 2026-07-04

## 구현 범위

`docs/oauth-login-plan.md`의 코드 구현 태스크 기준으로 네이버와 구글 OAuth Authorization Code 로그인 흐름을 추가했다. 실제 provider 왕복 검증은 로컬 `.env`에 OAuth client ID와 secret이 아직 없어 이번 범위에서 제외했다.

## 백엔드 변경

- `AppSettings`가 `QUESTBOOK_PUBLIC_BASE_URL`, `NAVER_OAUTH_CLIENT_ID`, `NAVER_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`를 읽는다.
- `OAuthStateStore`를 추가해 Redis에 OAuth state를 TTL 600초로 저장하고 callback에서 단회 소비한다.
- Redis `GETDEL` 미지원 환경을 위해 Lua 기반 원자적 get/delete fallback을 추가했다.
- provider client를 추가해 네이버/구글 인가 URL 생성, code-token 교환, 프로필 조회 응답 정규화를 수행한다.
- token/profile 응답에서 OAuth 오류, 필수 값 누락, `None` 토큰, non-Bearer token을 거부한다. Google 권한은 provider token 응답의 scope 문자열 대신 userinfo 프로필 조회 성공으로 확인한다.
- `/api/auth/providers`가 네이버/구글 설정 여부를 실제 환경 변수 기준으로 반환한다.
- `POST /api/auth/{provider}/start`가 동의 3항목과 브라우저 nonce를 검증한 뒤 `{authorizeUrl}` JSON을 반환한다.
- `GET /api/auth/{provider}/callback`이 state를 소비하고 provider 프로필로 사용자 find-or-create 후 짧은 수명의 단회 `oauth_code`를 발급한다.
- callback 성공 HTML에는 JWT를 넣지 않고 `/#oauth_code=...`만 전달한다.
- 프런트는 `POST /api/auth/oauth-code/redeem`에 `oauth_code`와 `sessionStorage` nonce를 함께 보내 앱 JWT로 교환한다.
- callback HTML은 CORS wildcard 없이 `no-store`와 CSP로 응답한다.
- provider 취소/거부 callback도 state를 소비하고 `/#oauth_error=provider_denied`로 복귀한다.
- OAuth identity 저장은 DB `ON CONFLICT` 기반 upsert로 바꿔 같은 provider 계정 재로그인 시 기존 baseline user_id를 유지한다.

## 프런트엔드 변경

- 동의 패널에 네이버/구글 로그인 버튼을 추가했다.
- OAuth start 전에 브라우저 nonce를 생성해 `sessionStorage`에 저장하고 API 본문에 함께 보낸다.
- callback fragment의 `oauth_code`를 nonce와 함께 서버에 redeem한 뒤 받은 `accessToken`만 localStorage에 저장하고 주소창 fragment를 제거한다.
- callback fragment의 `oauth_error`는 access token과 nonce를 제거한 뒤 동의 패널에 오류를 표시한다.
- 잘못 인코딩된 fragment가 앱 초기화를 중단하지 않도록 안전 디코딩을 적용했다.
- OAuth 버튼 중복 클릭 방지를 위해 pending 동안 버튼을 비활성화한다.
- provider 화면에서 브라우저 Back으로 돌아온 bfcache 복원 상황에서는 OAuth 버튼 pending 상태를 해제한다.
- 서비스워커 정적 캐시 버전을 `v5`로 올려 기존 PWA 캐시가 새 OAuth 코드를 계속 잡고 있지 않게 했다.
- 서비스워커와 localStorage의 인증 추천 응답 캐시를 제거해 사용자별 추천·위치 데이터가 다른 세션에 남지 않게 했다.

## 보안 보완

- OAuth provider가 `error`와 `state`를 돌려주는 취소/거부 callback도 state를 소비한다.
- 앱 API와 웹 게이트웨이는 wildcard CORS를 제거하고, 앱 API는 설정된 `QUESTBOOK_PUBLIC_BASE_URL` origin만 허용한다.
- 인증 JSON 응답에는 `Cache-Control: no-store`를 붙인다.
- OAuth provider가 설정됐거나 비로컬 host로 실행할 때 `QUESTBOOK_JWT_SECRET`이 기본/예제/빈 값이거나 32자 미만이면 서버가 기동 중 실패한다.
- crypto API가 없는 브라우저에서는 OAuth nonce를 만들지 않고 로그인 시작을 중단한다.

## 리뷰 반영

- Google token response의 scope 문자열을 짧은 scope 이름으로 재검증하지 않도록 바꿨다. Google 권한은 userinfo 프로필 조회 성공으로 확인한다.
- 예제 JWT secret과 기본 JWT secret을 약한 값 목록으로 관리하고, OAuth 설정 또는 비로컬 host에서는 강한 secret을 요구한다.
- 프런트에서 raw JWT fragment를 받아들이는 `#oauth_token` 경로를 제거하고 `#oauth_code` redeem 경로만 유지한다.
- provider 화면에서 브라우저 Back으로 돌아온 bfcache 복원 시 OAuth 버튼 pending 상태를 해제한다.
- 단회 login code 소비 중 Redis 장애가 나면 잘못된 코드 400이 아니라 재시도 가능한 503으로 응답한다.
- `docs/oauth-login-plan.md`와 `Todo/oauth-login-plan.md`의 게이트웨이, callback, frontend 예시를 현재 구현 기준으로 갱신했다.

## 검증 결과

다음 검증을 통과했다.

```bash
cd services/app-api && uv run pytest -v
cd services/app-api && uv run python ../../tests/smoke/test_baseline_http.py -v
node --check apps/user-web/src/app.js
node --check apps/user-web/public/service-worker.js
python3 -m py_compile services/web-gateway/gateway.py
git diff --check
```

결과:

- 앱 API 테스트: 41개 통과
- 웹 게이트웨이 smoke 테스트: 2개 통과
- 프런트 JS와 서비스워커 문법 검사 통과
- 웹 게이트웨이 Python 문법 검사 통과
- diff 공백 검사 통과

## 남은 운영 확인

- 로컬 `.env`와 운영 `.env`에 OAuth client ID/secret을 입력해야 실제 로그인이 동작한다.
- 로컬 OAuth 테스트는 브라우저도 `QUESTBOOK_PUBLIC_BASE_URL`과 같은 `http://localhost:8000`으로 접속해야 한다.
- Google/Naver 콘솔의 redirect URI가 서버가 조립하는 값과 문자 단위로 일치해야 한다.
- 실제 provider 왕복은 키 입력 후 네이버와 구글 각각에서 로그인, 재로그인 동일 사용자 유지, provider 취소/거부 오류 복귀를 브라우저로 확인해야 한다.
