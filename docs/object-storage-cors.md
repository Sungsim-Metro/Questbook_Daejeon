# Object Storage CORS 설정 런북

이 문서는 다른 서버나 로컬 PC에서 Questbook 사진 업로드용 NCP Object Storage CORS를 조회하고 설정하는 절차를 설명한다. 버킷 생성과 인증키 준비는 [사진 증빙 저장 준비](./object-storage-setup.md)를 먼저 따른다.

## 1. 언제 다시 설정해야 하는가

CORS는 명령을 실행하는 컴퓨터가 아니라 **NCP 버킷에 저장되는 설정**이다. 같은 버킷과 같은 웹사이트 주소를 계속 사용한다면 서버를 옮기거나 앱 컨테이너를 다시 배포해도 CORS를 다시 설정할 필요가 없다.

| 변경 사항 | 필요한 작업 |
| :-- | :-- |
| 서버만 이전하고 버킷·웹사이트 주소는 동일 | CORS 변경 불필요. 새 서버에 앱 인증 설정을 주입한다. |
| 새로운 버킷 사용 | 새 버킷에 CORS를 설정한다. |
| 웹사이트 도메인, HTTP/HTTPS 또는 포트 변경 | 실제 브라우저 접속 origin을 허용 목록에 반영한다. |
| 다른 PC에서 기존 웹사이트에 접속 | CORS 변경 불필요. 접속한 PC의 IP는 허용 origin이 아니다. |
| 로컬 개발 서버에 직접 접속 | 해당 로컬 주소와 포트를 허용한다. |

Origin은 브라우저 주소창의 `스킴://호스트[:포트]`다. 경로, 쿼리, 마지막 `/`는 넣지 않는다. 예를 들어 `https://test.ilhyeon.com/quests`의 origin은 `https://test.ilhyeon.com`이다. 브라우저 개발자 도구 콘솔에서 `location.origin`으로 정확한 값을 확인할 수 있다.

| 브라우저 접속 주소 예시 | 허용할 origin |
| :-- | :-- |
| `http://localhost:8000` | `http://localhost:8000` |
| `http://127.0.0.1:8000` | `http://127.0.0.1:8000` |
| `http://test.ilhyeon.com` | `http://test.ilhyeon.com` |
| `https://test.ilhyeon.com` | `https://test.ilhyeon.com` |
| `https://www.travel-qbook.co.kr` | `https://www.travel-qbook.co.kr` |

`localhost`와 `127.0.0.1`, HTTP와 HTTPS, 서로 다른 포트는 다른 origin이다. ALB나 프록시를 거쳐 접속한다면 브라우저에 보이는 공개 주소를 사용한다. 내부 app VM 주소나 Object Storage API 주소를 넣는 것이 아니다.

## 2. 실행 환경 준비

아래 명령은 Bash 또는 Zsh 터미널 기준이다. 현재 프로젝트의 Python 기준은 3.11이며, 로컬 의존성 관리는 `uv`를 사용한다.

다음 설정이 실행 환경에 준비되어 있어야 한다.

- `NCP_OBJECT_STORAGE_ENDPOINT_URL`: 한국 리전 기본값 `https://kr.object.ncloudstorage.com`
- `NCP_OBJECT_STORAGE_REGION_NAME`: 기본값 `kr-standard`
- `NCP_OBJECT_STORAGE_BUCKET_NAME`: 변경할 버킷 이름
- `NCP_OBJECT_STORAGE_ACCESS_KEY`, `NCP_OBJECT_STORAGE_SECRET_KEY`: 해당 버킷 CORS 조회·변경 권한이 있는 API 인증키
- 나머지 앱 설정: 예제는 `AppSettings.from_env()`를 사용하므로 기존 앱 설정 검증도 통과해야 한다.

사진 업로드 권한과 버킷 CORS 변경 권한은 별개다. CORS 변경이 `AccessDenied`로 실패하면 버킷 소유자 또는 권한 관리자가 설정해야 한다. 버킷 ACL은 비공개로 유지한다. 인증키를 문서, 명령 인자, Git에 넣거나 `.env` 전체를 출력하지 않는다.

실행할 환경에 맞춰 **아래 세 가지 중 하나만** 선택한다. `CORS_RUNNER`는 공통 설정 코드를 실행할 명령 배열이며, 같은 터미널에서 다음 절까지 진행한다.

### 로컬·테스트 Docker Compose

먼저 실행 중인 컨테이너 이름을 확인한다.

```bash
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}'

# 변수 의미: Compose 앱 컨테이너에서 Python을 실행하는 명령이다.
CORS_RUNNER=(docker exec -i questbook-app python -)
```

Compose의 서비스 이름은 `app`, 컨테이너 이름은 `questbook-app`이다. 컨테이너 이름을 변경한 환경에서는 실제 이름으로 바꾼다. 앱에 이미 주입된 환경변수와 설치된 SDK를 사용하므로 호스트에 Python이나 `uv`를 추가 설치할 필요가 없다.

### 운영 Docker 서버

[클라우드 배포 런북](./deploy-cloud.md)의 app VM에서 실행한다. 이 배포 방식의 컨테이너 이름은 `qbook-app`이다. 웹 전용 컨테이너에는 Object Storage 인증 설정이 없다.

```bash
# 변수 의미: 운영 앱 컨테이너에서 Python을 실행하는 명령이다.
CORS_RUNNER=(docker exec -i qbook-app python -)
```

Docker에 관리자 권한이 필요한 환경은 배열의 첫 명령을 `sudo docker`로 바꾼다. 최종 앱 이미지에는 Python과 앱 패키지가 있으며, `uv` 및 저장소의 `scripts/` 디렉터리는 포함되지 않는다.

### Docker를 사용하지 않는 로컬 Python

저장소를 준비하고 [사진 증빙 저장 준비](./object-storage-setup.md)의 환경변수를 저장소 루트 `.env` 또는 프로세스 환경에 설정한다. 다음 경로 자리표시는 실제 저장소 경로로 바꾼다.

```bash
cd <Questbook_Dajeon-저장소-경로>
uv sync --project services/app-api --python 3.11 --frozen --no-dev

# 변수 의미: 로컬 앱 가상환경에서 Python을 실행하는 명령이다.
CORS_RUNNER=(uv run --project services/app-api --no-sync python -)
```

설정값의 우선순위는 **프로세스 환경변수 → `services/app-api/.env` → 저장소 루트 `.env` → 기본값**이다. 이미 export한 값이 있으면 `.env`를 수정해도 해당 값이 우선한다. 다른 서버에서는 기존 서버의 `.env`를 출력해서 복사하지 말고 승인된 비밀 관리 경로로 필요한 설정을 준비한다.

## 3. 변경 내용 미리 확인

아래 코드에서 `TARGET_BUCKET`과 `ALLOWED_ORIGINS`를 실제 환경에 맞게 수정한다. `qbooktest`와 도메인은 예시이며, 새 서버에서도 그 버킷을 사용하라는 의미는 아니다. 실제 사용하는 origin만 남긴다.

처음에는 `APPLY_CHANGES = False`로 실행한다. 이 상태에서는 현재 CORS와 적용 예정 규칙만 출력하며 버킷 설정을 바꾸지 않는다. 기존 규칙 JSON은 적용 전에 별도로 보관한다.

이 예제는 `questbook-browser-evidence`라는 ID의 규칙만 추가하거나 교체하고, 다른 ID 또는 ID가 없는 기존 규칙은 보존한다. 같은 버킷을 여러 환경이 공유하면 이 규칙의 `ALLOWED_ORIGINS`에 계속 허용할 주소를 모두 넣는다. 목록에서 주소를 빼더라도 다른 기존 규칙에서 그 주소를 허용하고 있으면 접근이 계속 허용될 수 있다.

```bash
"${CORS_RUNNER[@]}" <<'PY'
# 기존 규칙을 보존하며 Questbook 브라우저 사진 업로드용 CORS를 설정한다.
import base64
import hashlib
import json
from urllib.parse import urlsplit

from botocore.exceptions import ClientError

from questbook_api.integrations.object_storage.client import ObjectStorageClient
from questbook_api.settings import AppSettings

# 변수 의미: 작업자가 의도한 대상 버킷이며 앱 설정과 일치해야 한다.
TARGET_BUCKET = "qbooktest"
# 변수 의미: 브라우저 사진 업로드를 허용할 전체 웹사이트 origin 목록이다.
ALLOWED_ORIGINS = [
    "http://localhost:8000",
    "http://test.ilhyeon.com",
    "https://test.ilhyeon.com",
]
# 변수 의미: False는 미리보기, True는 실제 CORS 변경이다.
APPLY_CHANGES = False
# 변수 의미: 이 예제에서 추가하거나 교체할 규칙의 고정 식별자다.
RULE_ID = "questbook-browser-evidence"

# 변수 의미: 현재 실행 환경에서 읽은 앱 설정이다.
settings = AppSettings.from_env()
if settings.object_storage_bucket_name != TARGET_BUCKET:
    raise SystemExit("대상 버킷과 앱 설정이 다릅니다. 설정 출처를 확인하세요.")
if not ALLOWED_ORIGINS:
    raise SystemExit("허용할 origin을 하나 이상 입력하세요.")
for origin in ALLOWED_ORIGINS:  # 변수 의미: 형식을 검사할 접속 origin이다.
    parsed = urlsplit(origin)  # 변수 의미: 스킴, 호스트, 경로로 분리한 주소다.
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path or parsed.query or parsed.fragment
        or "*" in origin or any(character.isspace() for character in origin)
    ):
        raise SystemExit("origin에는 http(s)://호스트[:포트]만 입력하세요.")

# 변수 의미: 앱 인증 설정으로 구성한 S3 호환 클라이언트다.
s3 = ObjectStorageClient(settings)._s3_client()
try:
    # 변수 의미: 버킷에 이미 설정된 CORS 규칙 목록이다.
    current_rules = s3.get_bucket_cors(Bucket=TARGET_BUCKET).get("CORSRules", [])
except ClientError as error:  # 변수 의미: CORS 조회에 실패한 서비스 오류다.
    if error.response.get("Error", {}).get("Code") != "NoSuchCORSConfiguration":
        raise
    current_rules = []

# 변수 의미: 다른 용도의 기존 규칙을 보존하고 관리 대상 규칙만 제외한 목록이다.
next_rules = [rule for rule in current_rules if rule.get("ID") != RULE_ID]
next_rules.append({
    "ID": RULE_ID,
    "AllowedOrigins": ALLOWED_ORIGINS,
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000,
})

print("대상 버킷:", TARGET_BUCKET)
print("현재 규칙:", json.dumps(current_rules, ensure_ascii=False, indent=2))
print("예정 규칙:", json.dumps(next_rules, ensure_ascii=False, indent=2))
if not APPLY_CHANGES:
    print("미리보기 완료. 적용하려면 APPLY_CHANGES를 True로 바꾸고 다시 실행하세요.")
    raise SystemExit(0)

def add_content_md5(request, **kwargs):
    """
    입력: 서명 직전의 SDK 요청과 이벤트 인자.
    출력: 없음. 요청 헤더를 갱신한다.
    역할: 실제 XML 본문의 MD5를 추가하고 자동 CRC32 헤더를 제거한다.
    호출 예시: 아래 before-sign 이벤트가 이 함수를 호출한다.
    """
    request.headers["Content-MD5"] = base64.b64encode(
        hashlib.md5(request.body).digest()
    ).decode("ascii")
    for name in ("x-amz-checksum-crc32", "x-amz-sdk-checksum-algorithm"):
        # 변수 의미: NCP 요청에서 제거할 SDK 자동 체크섬 헤더 이름이다.
        if name in request.headers:
            del request.headers[name]

s3.meta.events.register("before-sign.s3.PutBucketCors", add_content_md5)
s3.put_bucket_cors(Bucket=TARGET_BUCKET, CORSConfiguration={"CORSRules": next_rules})
print("적용 후 규칙:", json.dumps(
    s3.get_bucket_cors(Bucket=TARGET_BUCKET)["CORSRules"],
    ensure_ascii=False,
    indent=2,
))
PY
```

NCP `PutBucketCORS`는 `Content-MD5`를 요구한다. 확인한 `boto3`/`botocore` 1.43.40은 기본적으로 CRC32를 사용하므로, 위 예제는 XML 본문 직렬화 후 서명 직전에 MD5를 추가한다. 이 처리는 해당 실행의 CORS 요청에만 적용되며 앱의 업로드 코드를 수정하지 않는다.

## 4. 실제 적용

미리보기에서 버킷, 기존 규칙 보존 여부, 허용할 주소를 확인한 다음 같은 코드의 `APPLY_CHANGES = False`를 `True`로 바꿔 다시 실행한다. 출력된 적용 후 규칙에 원하는 주소와 `PUT`이 있는지 확인한다.

`PutBucketCORS`는 버킷의 전체 CORS 구성을 교체하는 API다. 위 예제는 기존 규칙을 읽어 다른 규칙을 함께 보내지만, 동시에 다른 운영자가 수정하면 변경을 덮을 수 있다. 공유 버킷은 설정 변경을 한 번에 한 곳에서 수행한다. 서버가 여러 대라고 각 서버에서 반복 실행할 필요는 없다.

이 절의 작업은 CORS 설정만 변경한다. 버킷 공개 권한, 객체 원본, 앱 코드를 변경하지 않는다.

## 5. 브라우저 업로드 허용 확인

버킷 조회 성공과 브라우저 업로드 성공은 별개다. 아래 값은 3절에서 사용한 버킷과 실제 접속 origin으로 바꾼다. `cors-check.jpg`는 OPTIONS 대상 경로 예시이며, 이 요청은 사진을 생성하거나 업로드하지 않는다.

```bash
# 변수 의미: 점검할 실제 브라우저 접속 origin이다.
CORS_ORIGIN='http://test.ilhyeon.com'
# 변수 의미: 점검할 버킷 이름이다.
CORS_BUCKET='qbooktest'
# 변수 의미: 해당 버킷의 Object Storage API 엔드포인트다.
CORS_ENDPOINT='https://kr.object.ncloudstorage.com'

curl -i --max-time 15 -X OPTIONS \
  "$CORS_ENDPOINT/$CORS_BUCKET/cors-check.jpg" \
  -H "Origin: $CORS_ORIGIN" \
  -H 'Access-Control-Request-Method: PUT' \
  -H 'Access-Control-Request-Headers: content-type'
```

다음을 확인한다.

- HTTP 상태가 `2xx`다.
- `Access-Control-Allow-Origin`이 요청 origin과 일치한다. 기존에 전체 origin을 허용한 규칙이 있으면 `*`가 반환될 수 있으므로 규칙을 재확인한다.
- `Access-Control-Allow-Methods`에 `PUT`이 포함된다.
- `Access-Control-Allow-Headers`가 `content-type` 요청을 허용한다.

허용해야 하는 각 origin에 대해 반복한다. 이후 웹페이지를 새로고침하고 새 업로드 URL로 사진을 업로드한다. 브라우저 개발자 도구의 Network에서 아래 순서를 확인한다.

1. `POST /api/object-storage/upload-url`: `200`
2. Object Storage `OPTIONS`: `2xx`. 브라우저에 성공한 사전 요청이 캐시되어 있으면 생략될 수 있다.
3. Object Storage `PUT`: `2xx`

OPTIONS 성공은 CORS 허용만 증명한다. 최종 PUT 성공까지 확인해야 서명, 객체 쓰기 권한, 파일 전송을 검증한 것이다. presigned URL 전체에는 임시 접근 권한이 있으므로 채팅이나 로그에 붙이지 않는다.

## 6. 재시작·재배포가 필요한 경우

| 변경한 대상 | 반영 방법 |
| :-- | :-- |
| NCP 버킷 CORS 규칙만 변경 | 앱 재시작·이미지 재빌드 불필요. 페이지를 새로고침하고 재시도한다. |
| 로컬 Python 앱의 환경변수 또는 `.env` 변경 | 실행 중인 앱 API 프로세스를 재시작한다. |
| Compose의 `.env` 변경 | 환경변수를 다시 주입하도록 `app` 컨테이너를 재생성한다. |
| 운영 Secret Manager의 앱 설정 변경 | 설정을 동기화한 뒤 `qbook-app` 컨테이너를 재생성한다. |

Compose 기본 배포는 저장소 루트에서 다음과 같이 반영한다. 개발·클라우드 테스트 오버라이드를 사용했다면 **최초 배포와 동일한 `-f` 옵션**을 사용한다. 단순 `docker restart` 또는 `docker compose restart`는 새 `.env`를 주입하지 않는다.

```bash
docker compose up -d --no-deps --force-recreate app
```

[클라우드 배포 런북](./deploy-cloud.md)의 운영 Secret Manager 값을 변경했다면 해당 app VM에서 다음과 같이 반영한다. `qbook-bootstrap`은 Secret Manager의 값으로 로컬 배포 설정을 갱신하므로, 로컬 파일만 수동 변경한 상태에서 실행하면 그 값이 덮일 수 있다.

```bash
sudo systemctl restart qbook-bootstrap
sudo systemctl restart qbook-app
```

이 재시작 명령은 **앱 설정을 바꾼 경우에만** 사용한다. CORS 규칙 변경만을 위해 실행하지 않는다.

## 7. 자주 발생하는 오류

| 증상 | 확인할 내용 |
| :-- | :-- |
| `NoSuchCORSConfiguration` | 해당 버킷에 CORS가 없다. 위 예제는 이 오류만 빈 규칙으로 처리한다. |
| OPTIONS `403`, `AccessForbidden`, `CORSResponse` | origin, `PUT`, `content-type` 허용 여부와 실제 대상 버킷을 확인한다. |
| CORS 조회·변경의 `AccessDenied` 또는 `403` | 버킷 이름과 API 키의 버킷 CORS 조회·변경 권한을 확인한다. |
| `MissingContentMD5`, `InvalidDigest`, `BadDigest` | 위 예제의 MD5 이벤트 등록을 포함했는지 확인한다. JSON 문자열이 아니라 전송할 XML 바이트의 MD5여야 한다. |
| OPTIONS는 성공하지만 PUT은 `403` | 만료되지 않은 새 presigned URL, 키의 객체 쓰기 권한, 서명과 전송 `Content-Type` 일치를 확인한다. |
| 브라우저에 `Failed to fetch` | Network에서 OPTIONS 차단인지, 네트워크·TLS 문제인지 먼저 구분한다. |
| 버킷 점검 스크립트는 성공하지만 사진 업로드 실패 | `scripts/check_object_storage.py`는 HEAD 접근만 검사한다. 이 문서의 OPTIONS와 실제 PUT을 별도로 확인한다. |
| 대상 버킷 불일치 또는 설정이 비어 있음 | 실행 컨테이너, 로컬 환경변수 우선순위, `.env` 변경 후 컨테이너 재생성 여부를 확인한다. |
| JWT 설정 검증 오류로 실행 중단 | 예제가 전체 앱 설정을 읽으므로 해당 환경의 정상적인 앱 설정을 먼저 준비한다. |

## 공식 참고 자료

- [NCP Object Storage CORS CLI 안내](https://cli.ncloud-docs.com/docs/guide-objectstorage)
- [NCP PutBucketCORS: 설정 변경과 Content-MD5 요구사항](https://api.ncloud-docs.com/docs/storage-objectstorage-putbucketcors)
- [NCP GetBucketCORS: 설정 조회](https://api.ncloud-docs.com/docs/storage-objectstorage-getbucketcors)
- [NCP Object Storage 문제 해결: CORS 점검](https://guide.ncloud-docs.com/docs/objectstorage-troubleshoot-common)
