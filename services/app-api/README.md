# 앱 API 서비스

Python 앱 서버 구현 위치이다. 설계서의 앱 서버 계층에 해당하며, 외부 API 호출, Redis 임시 캐시, 추천 점수 계산, 퀘스트 생성과 완료 처리를 담당한다.

## 구조

```text
src/questbook_api/
  api/             HTTP 라우트와 요청/응답 계약
  application/     유스케이스 조합 로직
  domain/          설계서의 핵심 모델과 정책
  infrastructure/  PostgreSQL, Redis, 파일 저장소, 트랜잭션
  integrations/    TourAPI, NAVER Maps, Gemini, OAuth, Object Storage
  observability/   로그, 헬스체크, 지표
tests/             앱 API 테스트
```

## 구현된 baseline 구성

1. 헬스체크와 설정 로딩
2. TourAPI 클라이언트
3. 유저 단위 Redis 30분 임시 캐시
4. 추천 점수 계산
5. `ReusableQuest` 재사용 매칭
6. `UserQuestInstance` 생성
7. 퀘스트 완료 트랜잭션
8. Object Storage presigned 사진 증빙 업로드 준비

OpenAPI 원본 응답 전체를 PostgreSQL에 저장하지 않고, `contentId`와 표시명 같은 최소 참조값만 공용 퀘스트 자산에 남긴다. TourAPI 추천 후보는 유저 단위 Redis 30분 TTL 캐시에만 임시 보관한다.
사진 원본은 NCP Object Storage 비공개 버킷에 두고, DB에는 사용자 prefix 아래의 객체 키만 저장한다.

## 로컬 실행

앱 API는 로컬 PostgreSQL과 Redis가 먼저 실행되어 있어야 한다.

```bash
( cd ../.. && docker compose up -d postgres redis )
uv run python ../../scripts/check_local_data_services.py
PYTHONPATH=src uv run python -m questbook_api.server
```

저장소 루트에서 웹 게이트웨이까지 함께 실행할 때는 다음 명령을 사용한다.

```bash
docker compose up -d postgres redis
uv run --project services/app-api python scripts/run_baseline.py
```

## 환경 변수

| 이름 | 기본값 | 설명 |
| --- | --- | --- |
| `QUESTBOOK_DATABASE_URL` | `postgresql://questbook:questbook_local_password@127.0.0.1:5432/questbook` | baseline PostgreSQL 접속 URL |
| `QUESTBOOK_REDIS_URL` | `redis://127.0.0.1:6379/0` | TourAPI 임시 캐시 Redis URL |
| `QUESTBOOK_CACHE_TTL_SECONDS` | `1800` | Redis 캐시 TTL(초) |
| `QUESTBOOK_APP_API_HOST` | `127.0.0.1` | 앱 API 바인드 호스트 |
| `QUESTBOOK_APP_API_PORT` | `8100` | 앱 API 바인드 포트 |
| `TOURAPI_SERVICE_KEY` | 빈 값 | 한국관광공사 TourAPI 서비스 키. 비어 있으면 fallback 데이터 사용 |
| `NCP_OBJECT_STORAGE_ENDPOINT_URL` | `https://kr.object.ncloudstorage.com` | NCP Object Storage S3 호환 endpoint |
| `NCP_OBJECT_STORAGE_REGION_NAME` | `kr-standard` | NCP Object Storage 리전 |
| `NCP_OBJECT_STORAGE_BUCKET_NAME` | 빈 값 | 사진 증빙 전용 비공개 버킷 |
| `NCP_OBJECT_STORAGE_ACCESS_KEY` | 빈 값 | Object Storage 접근용 Access Key ID |
| `NCP_OBJECT_STORAGE_SECRET_KEY` | 빈 값 | Object Storage 접근용 Secret Key |
| `NCP_OBJECT_STORAGE_PRESIGNED_URL_TTL_SECONDS` | `600` | 업로드·다운로드 presigned URL 만료 시간 |
| `NCP_OBJECT_STORAGE_MAX_UPLOAD_BYTES` | `10485760` | 사진 1장 최대 업로드 크기 |
