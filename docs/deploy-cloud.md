# 클라우드 VM 컨테이너 배포 런북

이 문서는 단일 클라우드 테스트 VM에서 검증한 Questbook 컨테이너 이미지를 NCP Container Registry에 올리고, 여러 web/app VM에 배포하는 운영 절차를 설명한다. 로컬 PC가 아니라 **테스트 VM, app VM, web VM, NCP 콘솔**에서 수행할 작업을 구분한다.

## 1. 배포 구조

```text
사용자 브라우저
  → Public ALB(HTTPS)
  → web VM 여러 대: qbook-web 컨테이너(:8000)
  → Private ALB
  → app VM 여러 대: qbook-app 컨테이너(:8100)
  → Cloud DB PostgreSQL / Cloud DB for Cache / Object Storage / CLOVA OCR
```

배포 이미지와 실행 위치는 다음과 같다.

| 역할 | 이미지 | 컨테이너 이름 | 호스트 포트 | systemd 서비스 |
| :-- | :-- | :-- | :-- | :-- |
| 사용자 웹·API 프록시 | `<registry>/qbook-web:<sha>` | `qbook-web` | `8000` | `qbook-web.service` |
| 앱 API | `<registry>/qbook-app:<sha>` | `qbook-app` | `8100` | `qbook-app.service` |

Container Registry 이름이 `qbook-web`이어도 `/qbook-app:<tag>` 경로의 이미지는 app 이미지다. 레지스트리 호스트 이름이 아니라 repository 경로와 컨테이너 실행 명령으로 역할을 판단한다.

## 2. 반드시 지킬 배포 규칙

1. 운영 배포에는 `latest`가 아니라 Git 커밋 SHA 태그를 사용한다.
2. 빌드 전에 `git status --short`를 확인하고, 검증하지 않은 수정이 빌드 컨텍스트에 섞이지 않게 한다.
3. `qbook-web`과 `qbook-app`은 같은 `IMAGE_TAG`를 사용한다. 현재 배포 설정 시크릿이 두 서비스의 태그를 공통으로 관리하기 때문이다.
4. 시크릿을 이미지, Git 저장소, 명령행 인자에 넣지 않는다. Secret Manager와 권한 `600`의 env 파일로만 주입한다.
5. 정적 자산을 변경할 때는 `apps/user-web/public/service-worker.js`의 `STATIC_CACHE_NAME`도 새 값으로 변경한다.
6. app VM을 먼저 롤아웃하고 Private ALB 헬스체크가 복귀한 뒤 web VM을 롤아웃한다.
7. 한 VM의 정상 여부만 보고 전체 배포가 끝났다고 판단하지 않는다. 모든 ALB 타깃의 이미지 태그와 응답을 확인한다.

## 3. 1회 준비

### 3-1. NCP Container Registry와 계정

NCP 콘솔에서 Container Registry를 만들고 Public 또는 VPC에서 접근 가능한 Private Endpoint를 확보한다.

권한은 다음처럼 분리한다.

- 빌드 VM 계정: 이미지 push가 가능한 Container Registry Manager 권한
- app/web VM 부트스트랩 계정: 이미지 pull과 필요한 Secret Manager 시크릿 읽기만 가능한 최소 권한

부트스트랩 계정은 Sub Account의 API Gateway Access를 활성화하고 API 인증키를 발급한다. 루트 계정 키를 VM에 저장하지 않는다.

### 3-2. Secret Manager

다음 두 시크릿을 준비한다.

배포 설정 시크릿은 모든 VM이 공통으로 읽는다.

```dotenv
REGISTRY=qbook-web.kr.ncr.ntruss.com
IMAGE_TAG=<배포할-git-short-sha>
```

앱 설정 시크릿은 app VM만 읽는다. 기본 형식은 `infra/ncp/prod/app.env.example`을 따른다. DB, Redis, JWT, 지도, OAuth, TourAPI, Object Storage, CLOVA OCR 값을 포함한다.

### 3-3. 베이스 VM 이미지

app/web VM의 베이스 이미지에는 다음 항목을 설치한다.

- Ubuntu와 Docker
- `/etc/questbook` 디렉터리
- `/etc/systemd/system/qbook-bootstrap.service`
- app VM: `/etc/systemd/system/qbook-app.service`
- web VM: `/etc/systemd/system/qbook-web.service`
- `/usr/local/bin/qbook-bootstrap.sh`
- `/opt/questbook/sync_ncp_secret_env.py`
- `/etc/questbook/bootstrap.env`
- web VM: `/etc/questbook/web.env`

다음 항목은 베이스 VM 이미지에 포함하지 않는다.

- `/root/.docker/config.json`
- `/etc/questbook/deploy.env`
- `/etc/questbook/app.env`
- 실제 비밀번호, Secret Key, OAuth Client Secret
- 애플리케이션 Git checkout
- 기존 실행 컨테이너

app VM은 `qbook-bootstrap.service`, `qbook-app.service`를 enable한다. web VM은 `qbook-bootstrap.service`, `qbook-web.service`를 enable한다.

## 4. 테스트 VM에서 릴리스 준비

이 절의 명령은 단일 컨테이너 테스트를 완료한 **클라우드 테스트 VM**에서 실행한다.

### 4-1. 소스와 테스트 상태 확인

```bash
cd <Questbook_Dajeon-저장소-경로>

git status --short
git rev-parse --short HEAD
```

`scripts/build_push_images.py`는 현재 Git SHA를 이미지 태그로 사용하지만 Docker 빌드에는 커밋되지 않은 파일도 포함한다. 따라서 `git status --short`에 파일이 표시되면 그 변경이 의도한 릴리스 내용인지 먼저 확인한다.

현재 테스트 스택 상태를 확인한다.

```bash
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
```

테스트 Compose의 컨테이너 이름은 `questbook-app`, `questbook-web`이고 프로덕션 systemd 컨테이너 이름은 `qbook-app`, `qbook-web`이다.

테스트 VM의 전체 경로를 확인한다.

```bash
curl --fail http://127.0.0.1:8000/api/health
```

사진 첨부와 OCR 릴리스라면 올바른 백엔드 라우트도 확인한다. 백엔드는 URL을 `/`로 분리해 배열로 비교하므로 `grep 'ocr/receipt' server.py`로 확인하면 안 된다.

```bash
docker exec questbook-app \
  grep -n -E \
  '_handle_receipt_ocr|path_parts == \["api", "ocr", "receipt"\]' \
  /app/services/app-api/src/questbook_api/server.py
```

프론트엔드는 실제 URL 문자열을 사용하므로 다음처럼 확인한다.

```bash
docker exec questbook-web \
  grep -n 'ocr/receipt' \
  /app/apps/user-web/src/app.js
```

### 4-2. PWA 정적 캐시 버전 갱신

`apps/user-web/src`, `apps/user-web/public`의 정적 자산을 변경했다면 `apps/user-web/public/service-worker.js`의 캐시 이름도 이전 릴리스와 다른 값으로 변경한다.

```javascript
const STATIC_CACHE_NAME = "questbook-user-web-static-v8";
```

값은 릴리스마다 단조 증가하는 버전이나 고유한 릴리스 식별자를 사용한다. 캐시 이름을 바꾸지 않으면 기존 브라우저의 Service Worker가 이전 `app.js`와 CSS를 계속 반환할 수 있다. `curl`은 최신 파일을 보여주지만 브라우저만 구버전 화면을 보여주는 증상이 발생한다.

캐시 버전 변경을 포함한 모든 릴리스 파일을 커밋한 후 새 SHA를 확인한다.

```bash
git status --short
git rev-parse --short HEAD
```

## 5. 테스트 VM에서 이미지 빌드와 push

### 5-1. Registry 로그인

```bash
export REGISTRY='<실제-registry-endpoint>'

docker login -u '<빌드용-Access-Key>' "$REGISTRY"
```

Password 프롬프트에는 빌드용 Secret Key를 입력한다. 자동화할 때는 Secret Key가 쉘 히스토리에 남지 않도록 `--password-stdin`을 사용한다.

### 5-2. 실행 명령 미리 확인

```bash
uv run python scripts/build_push_images.py \
  --registry "$REGISTRY" \
  --dry-run
```

### 5-3. 이미지 빌드와 push

```bash
export IMAGE_TAG="$(git rev-parse --short HEAD)"

uv run python scripts/build_push_images.py \
  --registry "$REGISTRY"
```

스크립트는 다음 이미지를 빌드하고 push한다.

```text
<registry>/qbook-app:<sha>
<registry>/qbook-web:<sha>
<registry>/qbook-app:latest
<registry>/qbook-web:latest
```

`latest`는 편의 태그일 뿐 운영 배포에는 사용하지 않는다.

### 5-4. push 전후 이미지 내용 검증

app 이미지 안에 OCR 라우트가 포함됐는지 확인하는 예시는 다음과 같다.

```bash
docker run --rm \
  --entrypoint grep \
  "$REGISTRY/qbook-app:$IMAGE_TAG" \
  -n -E \
  '_handle_receipt_ocr|path_parts == \["api", "ocr", "receipt"\]' \
  /app/services/app-api/src/questbook_api/server.py
```

web 이미지 안에 최신 프론트엔드가 포함됐는지 확인한다.

```bash
docker run --rm \
  --entrypoint grep \
  "$REGISTRY/qbook-web:$IMAGE_TAG" \
  -n 'ocr/receipt' \
  /app/apps/user-web/src/app.js
```

필요한 코드가 나오지 않으면 해당 태그를 배포하지 않는다. 예전 로컬 이미지에 새 SHA 태그만 붙이지 말고 저장소 루트에서 Dockerfile로 다시 빌드한다.

## 6. 배포 설정 갱신

NCP Secret Manager의 배포 설정 시크릿을 새 SHA로 변경한다.

```dotenv
REGISTRY=<실제-registry-endpoint>
IMAGE_TAG=<새-git-short-sha>
```

배포 직전 이전 정상 태그를 별도로 기록한다.

```text
이전 정상 태그: <old-sha>
신규 배포 태그: <new-sha>
```

app VM의 `/etc/questbook/bootstrap.env`에는 `QBOOK_APP_SECRET_ID`를 채운다. web VM에서는 이 값을 비워둔다. 실제 배포 설정과 app 시크릿은 `qbook-bootstrap.service`가 Secret Manager에서 받아 다음 파일로 생성한다.

```text
/etc/questbook/deploy.env
/etc/questbook/app.env  # app VM만
```

## 7. app VM 롤아웃

이 절은 각 app VM에서 실행한다. 여러 VM을 한 번에 재시작하지 말고 한 대씩 처리한다.

```bash
systemctl restart qbook-bootstrap
systemctl restart qbook-app
```

서비스와 컨테이너 상태를 확인한다.

```bash
systemctl status qbook-bootstrap --no-pager
systemctl status qbook-app --no-pager

docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
ss -tlnp | grep ':8100'
```

실행 이미지와 재시작 횟수를 확인한다.

```bash
docker inspect qbook-app \
  --format 'image={{.Config.Image}} id={{.Image}} started={{.State.StartedAt}} restart={{.RestartCount}}'
```

헬스체크를 실행한다.

```bash
curl --fail http://127.0.0.1:8100/health
```

OCR 릴리스라면 백엔드 코드와 설정 존재 여부를 확인한다.

```bash
docker exec qbook-app \
  grep -n -E \
  '_handle_receipt_ocr|path_parts == \["api", "ocr", "receipt"\]' \
  /app/services/app-api/src/questbook_api/server.py
```

시크릿 값 자체를 출력하지 않고 필요한 환경변수의 설정 여부만 확인한다.

```bash
docker exec qbook-app python -c '
import os
names = [
    "NCP_CLOVA_OCR_INVOKE_URL",
    "NCP_CLOVA_OCR_SECRET_KEY",
    "NCP_OBJECT_STORAGE_BUCKET_NAME",
    "NCP_OBJECT_STORAGE_ACCESS_KEY",
    "NCP_OBJECT_STORAGE_SECRET_KEY",
]
print({name: bool(os.getenv(name)) for name in names})
'
```

Private ALB의 app 타깃이 Healthy로 복귀한 뒤 다음 app VM을 처리한다.

## 8. web VM 롤아웃

모든 app 타깃이 정상인 것을 확인한 뒤 각 web VM에서 한 대씩 실행한다.

```bash
systemctl restart qbook-bootstrap
systemctl restart qbook-web
```

상태와 실행 이미지를 확인한다.

```bash
systemctl status qbook-web --no-pager

docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
docker inspect qbook-web \
  --format 'image={{.Config.Image}} id={{.Image}} started={{.State.StartedAt}} restart={{.RestartCount}}'
ss -tlnp | grep ':8000'
```

web 컨테이너의 정적 파일과 app 프록시를 확인한다.

```bash
docker exec qbook-web \
  grep -n 'ocr/receipt' \
  /app/apps/user-web/src/app.js

curl --fail http://127.0.0.1:8000/api/health
```

Public ALB의 web 타깃이 Healthy로 복귀한 뒤 다음 web VM을 처리한다.

## 9. 외부 검증

### 9-1. 모든 web 타깃 버전 확인

외부 정적 파일을 여러 번 요청해 ALB 뒤에 구버전 web VM이 섞이지 않았는지 확인한다.

```bash
for i in $(seq 1 20); do
  if curl -fsS \
    -H 'Cache-Control: no-cache' \
    "https://www.travel-qbook.co.kr/src/app.js?v=$RANDOM-$i" |
    grep -q 'ocr/receipt'; then
    echo "$i 최신"
  else
    echo "$i 구버전 또는 요청 실패"
  fi
done
```

최신과 구버전이 섞이면 Public ALB의 타깃별 컨테이너 이미지 태그를 다시 확인한다.

### 9-2. Service Worker 버전 확인

```bash
curl -fsS \
  "https://www.travel-qbook.co.kr/service-worker.js?v=$(date +%s)" |
  grep STATIC_CACHE_NAME
```

출력된 캐시 이름이 이번 릴리스에서 변경한 값인지 확인한다.

### 9-3. 브라우저 기능 확인

1. 시크릿 창에서 `https://www.travel-qbook.co.kr`에 접속한다.
2. 로그인, 지도, 추천, 퀘스트 수락을 확인한다.
3. JPEG 또는 PNG 사진을 첨부한다.
4. Object Storage 업로드 완료를 확인한다.
5. 영수증 퀘스트에서 OCR 완료와 상호명·품목·시간 보조 결과를 확인한다.
6. 완료 여부는 기존 정책대로 GPS가 결정하고 OCR 결과는 보조 정보로만 기록되는지 확인한다.

시크릿 창은 최신인데 기존 브라우저만 구버전이면 브라우저에서 다음 순서로 사이트 데이터를 정리한다.

```text
개발자 도구 → Application → Service Workers → Unregister
개발자 도구 → Application → Storage → Clear site data
해당 사이트 탭을 모두 닫은 뒤 다시 접속
```

## 10. Auto Scaling Group 무중단 교체

수동으로 app/web VM 한 대씩 배포를 검증한 후 ASG 교체 방식을 사용한다.

1. 새 이미지를 Registry에 push한다.
2. Secret Manager의 `IMAGE_TAG`를 새 SHA로 변경한다.
3. app ASG desired 수를 한 대 늘린다.
4. 새 app VM이 부팅하면서 새 태그를 pull하고 Private ALB 헬스체크를 통과하는지 확인한다.
5. 구 app VM 한 대를 제거한다.
6. 모든 app VM이 교체될 때까지 반복한다.
7. 같은 절차로 web ASG를 교체한다.
8. desired 수를 원래 값으로 되돌린다.

새 애플리케이션 릴리스마다 베이스 VM 이미지를 다시 만들 필요는 없다. Docker, systemd 유닛, 부트스트랩 스크립트가 바뀐 경우에만 베이스 VM 이미지와 Launch Configuration을 갱신한다.

## 11. 롤백

Secret Manager의 `IMAGE_TAG`를 배포 전에 기록한 이전 정상 SHA로 되돌린다.

app VM을 먼저 한 대씩 롤백한다.

```bash
systemctl restart qbook-bootstrap
systemctl restart qbook-app
curl --fail http://127.0.0.1:8100/health
```

Private ALB가 정상인 것을 확인한 뒤 web VM을 한 대씩 롤백한다.

```bash
systemctl restart qbook-bootstrap
systemctl restart qbook-web
curl --fail http://127.0.0.1:8000/api/health
```

PWA 정적 자산까지 롤백해야 한다면 롤백 릴리스의 Service Worker도 현재 운영 버전과 다른 고유 캐시 이름을 사용해야 한다. 같은 캐시 이름을 재사용하면 브라우저가 롤백된 정적 파일을 받지 못할 수 있다.

## 12. 장애 판별표

| 증상 | 우선 확인 | 판단과 조치 |
| :-- | :-- | :-- |
| `docker ps`에는 app이 있지만 브라우저 화면이 예전 버전 | 외부 `/src/app.js`, web VM 이미지, Service Worker | 화면은 app이 아니라 web 컨테이너가 제공한다. 정적 파일이 최신이면 브라우저 캐시를 확인한다. |
| `curl`은 최신인데 브라우저만 구버전 | `service-worker.js`의 `STATIC_CACHE_NAME` | 정적 자산 변경 시 캐시 이름을 갱신하지 않은 경우다. 새 캐시 이름으로 web 이미지를 다시 배포한다. |
| 외부 요청마다 최신/구버전이 번갈아 나옴 | Public ALB의 모든 web 타깃 | 서로 다른 이미지 태그의 web VM이 혼재한 상태다. |
| `grep 'ocr/receipt' server.py` 결과가 없음 | `_handle_receipt_ocr`, `path_parts` 배열 | 백엔드는 URL을 토큰 배열로 비교한다. 올바른 패턴으로 다시 확인한다. |
| app VM의 `8100`은 열렸지만 기능이 실패 | `docker logs`, `/health`, env 설정 여부 | 포트 LISTEN은 프로세스 존재만 뜻한다. DB, Redis, Object Storage, OCR 상태를 별도로 확인한다. |
| 이미지 호스트 이름에 `qbook-web`이 있어 app이 아닌 것처럼 보임 | 전체 이미지 참조와 실행 명령 | `<registry>/qbook-app:<sha>`이면 app 이미지다. Registry 이름은 역할 판별 기준이 아니다. |
| 테스트 VM에서 `docker exec qbook-app`이 실패 | `docker ps --format '{{.Names}}'` | 테스트 Compose 이름은 `questbook-app`, 운영 systemd 이름은 `qbook-app`이다. |
| 컨테이너가 반복 재시작 | `docker inspect ... RestartCount`, `journalctl` | env 누락, DB/Redis 연결, 약한 JWT Secret, pull 실패를 확인한다. |
| Registry pull 실패 | `qbook-bootstrap` 로그와 endpoint | pull 권한, API 키, NAT/443 경로, Public/Private Registry endpoint를 확인한다. |

로그 확인 명령은 다음과 같다.

```bash
journalctl -u qbook-bootstrap -n 100 --no-pager
journalctl -u qbook-app -n 200 --no-pager
journalctl -u qbook-web -n 200 --no-pager
docker logs --tail 200 qbook-app
docker logs --tail 200 qbook-web
```

## 13. 배포 완료 체크리스트

- [ ] 테스트 VM의 검증 코드와 Git SHA가 일치한다.
- [ ] 정적 자산 변경 시 Service Worker 캐시 이름을 갱신했다.
- [ ] `qbook-app:<sha>`, `qbook-web:<sha>` 이미지 내용을 실행 전 검사했다.
- [ ] 두 이미지를 Registry에 push했다.
- [ ] Secret Manager의 `IMAGE_TAG`를 새 SHA로 변경했다.
- [ ] 모든 app VM이 새 태그를 실행한다.
- [ ] 모든 app 타깃이 Private ALB에서 Healthy다.
- [ ] 모든 web VM이 새 태그를 실행한다.
- [ ] 모든 web 타깃이 Public ALB에서 Healthy다.
- [ ] 외부 반복 요청에서 구버전 web 응답이 없다.
- [ ] Service Worker가 이번 릴리스 캐시 이름을 제공한다.
- [ ] 사진 첨부, Object Storage 업로드, OCR 보조 검증을 확인했다.
- [ ] 이전 정상 SHA를 기록해 즉시 롤백할 수 있다.

## 14. 관련 파일

- `scripts/build_push_images.py`: `qbook-web`, `qbook-app` 이미지 빌드와 push
- `infra/ncp/prod/qbook-bootstrap.sh`: Secret Manager 동기화와 Registry 로그인
- `infra/ncp/prod/qbook-bootstrap.service`: 부팅 시 배포 설정 준비
- `infra/ncp/prod/qbook-app.service`: app 컨테이너 pull과 실행
- `infra/ncp/prod/qbook-web.service`: web 컨테이너 pull과 실행
- `infra/ncp/prod/*.env.example`: 배포 환경 파일 템플릿
- `docs/object-storage-setup.md`: 사진 증빙 버킷과 CORS 설정
- `docs/clova-ocr-setup.md`: CLOVA OCR와 API Gateway 연동
