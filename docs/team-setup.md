# 팀 개발 환경 & 테스트 가이드

## 1. 온보딩 (5분)

사전 요구: git, Docker Engine + Docker Compose v2.

```bash
git clone <repo-url> && cd Questbook_Dajeon
cp .env.example .env
# 필수: JWT 시크릿을 강한 값으로 교체한다.
# 컨테이너의 app은 0.0.0.0으로 바인드하므로 기본 시크릿이면 기동이 거부된다.
sed -i "s|^QUESTBOOK_JWT_SECRET=.*|QUESTBOOK_JWT_SECRET=$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')|" .env
docker compose up -d --build
# 브라우저: http://localhost:8000 → demo-social 로그인 → 추천 확인
```

외부 API(네이버 지도, TourAPI, OAuth, Object Storage)를 쓰려면 담당자에게 해당 키를 받아 `.env`에 채운다.
키가 없어도 fallback 데이터로 baseline 흐름을 실행할 수 있다.

## 2. 개발 루프 (재빌드 없이 코드 반영)

```bash
docker compose -f docker-compose.yaml -f docker-compose.dev.yaml up -d
```

- `apps/user-web` (HTML/JS/CSS): 저장 즉시 반영 (새로고침만)
- `services/app-api`, `services/web-gateway` (Python): `docker compose restart app web`

의존성(`pyproject.toml`)이 바뀌면 다음 명령으로 이미지를 다시 빌드한다.

```bash
docker compose up -d --build
```

## 3. 테스트

```bash
uv run --project services/app-api pytest services/app-api/tests tests/smoke -v
```

smoke 테스트는 compose의 PostgreSQL(`127.0.0.1:5432`, `questbook_test` DB)과 Redis(`db 15`)를 사용한다.
스택이 떠 있으면 그대로 실행하면 된다.

## 4. Tailscale로 외부 기기(핸드폰 등)에서 테스트

1. 테스트 기기를 같은 tailnet에 조인한다.
2. 서버 머신에서 스택을 기동한 뒤 기기 브라우저에서 `http://<MagicDNS이름>:8000`에 접속한다.
   web만 `0.0.0.0:8000`에 노출된다. DB/app 포트는 tailnet에 노출되지 않는다.
3. GPS·카메라 등 실기기 기능은 이 경로로 테스트한다. 로그인은 demo-social 흐름(`/api/auth/demo-login`)을 사용한다.

### OAuth(네이버/구글)까지 외부 기기에서 테스트하려면

- `redirect_uri`가 `QUESTBOOK_PUBLIC_BASE_URL` 기반이므로 그 주소를 각 개발자 콘솔에 등록해야 한다.
- 구글은 `localhost` 외 `http`/IP 리터럴을 거부한다.
- 권장: `tailscale serve`로 `https://<machine>.<tailnet>.ts.net` 발급 → `.env`의 `QUESTBOOK_PUBLIC_BASE_URL`에 설정 → 콘솔에 등록 → app 재시작.

## 5. 클라우드 테스트 VM (throwaway)

1. VM 생성(도커 설치) → `git clone` → `.env` 작성(`QUESTBOOK_PUBLIC_BASE_URL`을 VM 주소로, `QUESTBOOK_JWT_SECRET`은 온보딩과 동일하게 강한 값으로 생성).
2. 다음 명령으로 스택을 기동한다.

```bash
curl -fsSL https://get.docker.com | sudo sh
docker compose -f docker-compose.yaml -f docker-compose.cloud-test.yaml up -d --build
```

3. 데이터는 VM 볼륨에만 쌓인다. 테스트가 끝나면 VM째 삭제한다.

## 6. 프로덕션 배포

프로덕션 배포는 `docs/deploy-cloud.md`에서 정리한다.
