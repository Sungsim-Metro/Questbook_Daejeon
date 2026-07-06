# 클라우드 프로덕션 배포 (컨테이너 + 관리형 서비스)

아키텍처: ALB(HTTPS) → web 컨테이너(ASG VM, `:8000`) → 내부 ALB → app 컨테이너(ASG VM, `:8100`) → Cloud DB PostgreSQL(멀티존 HA) / Cloud DB for Cache / Object Storage.
ALB 타겟 포트는 기존과 동일하게 web `8000`, app `8100`을 사용하므로 타겟 그룹 변경이 없다.

## 1회 준비

1. NCP Container Registry를 생성하고 레지스트리 주소를 확보한다.
2. 부트스트랩 전용 최소권한 Sub Account를 생성한다. API Gateway 이용을 활성화하고, 정책은 Container Registry pull 권한과 아래 Secret Manager 시크릿 읽기 권한으로 제한한다.
3. Secret Manager에 시크릿 2개를 등록한다.
   - 배포 설정 시크릿: `REGISTRY`, `IMAGE_TAG`
   - 앱 시크릿: `app.env`에 들어갈 앱 API 환경 변수 전체
4. 빌드 머신에서 `docker login <registry>`를 실행한다. 로그인에는 NCP API 인증키를 사용한다.
5. 베이스 VM 이미지 1개를 동결한다: Ubuntu + Docker 설치 + `/etc/questbook` 디렉터리 + `qbook-bootstrap.service`, `qbook-app.service`, `qbook-web.service`를 `/etc/systemd/system/`에 복사 + `/usr/local/bin/qbook-bootstrap.sh` + `/opt/questbook/sync_ncp_secret_env.py`.
6. `/etc/questbook/bootstrap.env`를 배치하고 권한을 `600`으로 제한한다. app VM은 `QBOOK_APP_SECRET_ID`를 채우고, web VM은 비워둔다.
7. web VM에는 `/etc/questbook/web.env`를 배치하고 권한을 `600`으로 제한한다. `deploy.env`와 app VM의 `app.env`는 부팅 시 Secret Manager에서 자동 생성하므로 이미지에 넣지 않는다.
8. web VM 이미지는 `qbook-bootstrap.service`와 `qbook-web.service`만 enable하고, app VM 이미지는 `qbook-bootstrap.service`와 `qbook-app.service`만 enable한다.
9. registry 인증은 부팅 때 `qbook-bootstrap.service`가 수행한다. 루트의 `/root/.docker/config.json`이 베이스 VM 이미지에 포함되지 않도록 주의한다.

## 환경 파일

`infra/ncp/prod/bootstrap.env.example`을 `/etc/questbook/bootstrap.env`로 복사한다. 이 파일에는 부트스트랩 전용 최소권한 Sub Account 키와 Secret Manager secretId만 넣는다.

`infra/ncp/prod/deploy.env.example`은 Secret Manager 배포 설정 시크릿의 payload 템플릿이다. 부팅 시 `/etc/questbook/deploy.env`로 자동 생성된다.

`infra/ncp/prod/app.env.example`은 Secret Manager 앱 시크릿의 payload 템플릿이다. app VM 부팅 시 `/etc/questbook/app.env`로 자동 생성된다.

`infra/ncp/prod/web.env.example`을 `/etc/questbook/web.env`로 복사한다. `QUESTBOOK_APP_API_BASE_URL`은 내부(private) ALB 주소와 app 타겟 포트 `8100`을 가리켜야 한다.

## 배포(롤아웃)

1. 새 이미지를 빌드하고 푸시한다.

```bash
uv run python scripts/build_push_images.py --registry <registry>
```

2. Secret Manager의 배포 설정 시크릿에서 `IMAGE_TAG=<새 sha>`로 변경한다.
3. app VM에서는 `systemctl restart qbook-bootstrap qbook-app`, web VM에서는 `systemctl restart qbook-bootstrap qbook-web`을 실행한다.
4. ALB 헬스체크가 복귀를 확인한다.
5. ASG 인스턴스 교체 방식(무중단)을 원하면 desired 증가 → 새 VM이 부팅 중 Secret Manager의 현재 `IMAGE_TAG`를 받아 기동 → 헬스체크 통과 후 desired 감소로 구 VM 제거 순서로 진행한다. 기존 롤링 방식과 동일하며 이미지 재굽기는 필요 없다.

## 롤백

Secret Manager의 배포 설정 시크릿에서 `IMAGE_TAG`를 이전 sha로 되돌리고 systemd 서비스를 재시작한다.

```bash
systemctl restart qbook-bootstrap qbook-app
systemctl restart qbook-bootstrap qbook-web
```

## 로컬 리허설

systemd 없이 프로덕션의 `docker run` 형태만 로컬에서 재현한다. 현재 루트 compose는 PostgreSQL과 Redis를 호스트 `127.0.0.1`에만 publish하므로, 별도 `docker run` 컨테이너는 `host.docker.internal`이 아니라 `questbook_default` 네트워크와 `postgres`/`redis` 서비스명으로 연결한다.

```bash
docker compose up -d postgres redis
docker run -d --rm --name qbook-app-prodform -p 18100:8100 \
  --network questbook_default \
  -e QUESTBOOK_APP_API_HOST=0.0.0.0 \
  -e QUESTBOOK_JWT_SECRET="$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')" \
  -e QUESTBOOK_DATABASE_URL="postgresql://questbook:questbook_local_password@postgres:5432/questbook" \
  -e QUESTBOOK_REDIS_URL="redis://redis:6379/0" \
  qbook-app:local
curl -s http://127.0.0.1:18100/health
docker stop qbook-app-prodform
```

web 컨테이너도 같은 방식으로 app 서비스에 연결해 프록시를 확인한다.

```bash
docker run -d --rm --name qbook-web-prodform -p 18000:8000 \
  --network questbook_default \
  -e QUESTBOOK_WEB_HOST=0.0.0.0 \
  -e QUESTBOOK_WEB_PORT=8000 \
  -e QUESTBOOK_APP_API_BASE_URL=http://app:8100 \
  qbook-web:local
curl -s http://127.0.0.1:18000/api/health
docker stop qbook-web-prodform
```

systemd 유닛 문법은 `systemd-analyze`가 있는 환경에서 확인한다. 로컬에 `docker.service`가 없으면 관련 경고가 나올 수 있으며, 문법 오류가 없으면 통과로 본다.

```bash
systemd-analyze verify infra/ncp/prod/qbook-bootstrap.service 2>&1 | grep -v "Failed to open" || true
systemd-analyze verify infra/ncp/prod/qbook-app.service 2>&1 | grep -v "Failed to open" || true
systemd-analyze verify infra/ncp/prod/qbook-web.service 2>&1 | grep -v "Failed to open" || true
```

## 주의

- `latest` 태그로 배포하지 않는다. 항상 sha 태그를 명시한다.
- 시크릿은 이미지에 넣지 않는다. `/etc/questbook/*.env` 파일(권한 `600`)로만 주입한다.
- app 컨테이너는 `0.0.0.0`에 바인드하므로 `QUESTBOOK_JWT_SECRET`이 비어 있거나 약하면 기동을 거부한다.
- `bootstrap.env`에는 부트스트랩 전용 최소권한 키만 넣는다. 루트 계정 키를 넣지 않는다.
- 기존 Launch Configuration의 init script에서 `git pull`로 배포하던 절차는 제거한다.
