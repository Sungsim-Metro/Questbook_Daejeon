# NCP Object Storage 사진 증빙 저장 준비

이 문서는 영수증 OCR 사진, 퀘스트 인증 사진, 사용자 인증 사진을 Naver Cloud Platform Object Storage에 저장하기 위한 준비 절차를 정의한다.

## 구현 상태

- 앱 API에 NCP Object Storage S3 호환 클라이언트가 추가되어 있다.
- 서버는 `boto3`로 Object Storage에 접근한다.
- 브라우저에는 Access Key와 Secret Key를 전달하지 않는다.
- 브라우저는 앱 API에서 받은 짧은 만료 시간의 presigned PUT URL로 비공개 버킷에 직접 업로드한다.
- DB에는 원본 파일이 아니라 `quest_completions.photo_ref`에 Object Storage 객체 키만 저장한다.
- 다운로드와 SNS 공유 직전에는 앱 API가 현재 사용자 prefix에 속한 객체만 presigned GET으로 발급한다.

참고 공식 문서:

- [NCP Object Storage Python용 AWS SDK(Boto3)](https://guide.ncloud-docs.com/docs/storage-storage-8-2)
- [NCP Object Storage API 가이드](https://api.ncloud-docs.com/docs/storage-objectstorage)
- [NCP Object Storage PutBucketCORS](https://api.ncloud-docs.com/docs/storage-objectstorage-putbucketcors)

## NCP 콘솔에서 할 일

1. Object Storage 서비스를 신청한다.
2. 한국 리전 버킷을 생성한다.
   - 권장 버킷명 예: `qbook-evidence-dev`, `qbook-evidence-prod`
   - 버킷 ACL은 비공개로 둔다.
   - 버킷은 사진 증빙 전용으로 분리한다.
3. API 인증 키를 준비한다.
   - 운영은 루트 계정보다 Object Storage에 필요한 권한만 가진 Sub Account 키를 권장한다.
   - Access Key ID와 Secret Key는 서버 `.env` 또는 비밀 관리 도구에만 저장한다.
4. 브라우저 직접 업로드를 위해 버킷 CORS를 설정한다.

```xml
<CORSConfiguration>
  <CORSRule>
    <AllowedOrigin>https://www.travel-qbook.co.kr</AllowedOrigin>
    <AllowedOrigin>http://localhost:8000</AllowedOrigin>
    <AllowedMethod>GET</AllowedMethod>
    <AllowedMethod>PUT</AllowedMethod>
    <AllowedMethod>HEAD</AllowedMethod>
    <AllowedHeader>*</AllowedHeader>
    <ExposeHeader>ETag</ExposeHeader>
    <MaxAgeSeconds>3000</MaxAgeSeconds>
  </CORSRule>
</CORSConfiguration>
```

로컬에서 다른 origin으로 테스트하면 해당 origin을 `AllowedOrigin`에 추가한다. 운영에서는 임시 테스트 origin을 제거한다.

## `.env`에 넣을 값

저장소 루트 `.env` 또는 배포 서버의 비밀 설정에 아래 값을 넣는다.

```ini
NCP_OBJECT_STORAGE_ENDPOINT_URL=https://kr.object.ncloudstorage.com
NCP_OBJECT_STORAGE_REGION_NAME=kr-standard
NCP_OBJECT_STORAGE_BUCKET_NAME=<버킷 이름>
NCP_OBJECT_STORAGE_ACCESS_KEY=<Access Key ID>
NCP_OBJECT_STORAGE_SECRET_KEY=<Secret Key>
NCP_OBJECT_STORAGE_PRESIGNED_URL_TTL_SECONDS=600
NCP_OBJECT_STORAGE_MAX_UPLOAD_BYTES=10485760
NCP_OBJECT_STORAGE_ADDRESSING_STYLE=path
```

`NCP_OBJECT_STORAGE_MAX_UPLOAD_BYTES=10485760`은 사진 1장 최대 10MiB 정책값이며 presigned URL 응답에 함께 내려간다. presigned PUT 자체가 파일 크기를 대신 검사하지는 않으므로 프런트엔드 업로드 전 검증과 업로드 완료 후 서버 검증을 추가해야 한다. OCR용 영수증 사진은 원본을 그대로 무제한 저장하지 않고, 필요하면 업로드 전 클라이언트에서 리사이즈하는 정책을 별도로 정한다.

## 연결 확인

앱 API 의존성을 설치한 뒤 아래 명령을 실행한다.

```bash
cd /home/ilhyeonchu/Documents/GitHub/Questbook_Dajeon/services/app-api
uv sync
uv run python ../../scripts/check_object_storage.py
```

성공하면 다음 형태가 출력된다.

```text
endpoint: https://kr.object.ncloudstorage.com
region: kr-standard
bucket: qbook-evidence-dev
OK - Object Storage 버킷 접근 가능: qbook-evidence-dev
```

실패하면 `missing` 목록 또는 `head_bucket` 오류 코드를 기준으로 버킷명, 키 권한, CORS, 네트워크 아웃바운드를 확인한다. Secret Key 값은 출력하지 않는다.

## 앱 API 사용 흐름

1. 로그인 후 사진을 업로드하기 전에 앱 API에 presigned PUT URL을 요청한다.

```http
POST /api/object-storage/upload-url
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "purpose": "quest_receipt",
  "contentType": "image/jpeg",
  "questInstanceId": "uqi_example"
}
```

허용 목적은 `quest_receipt`, `quest_photo`, `user_auth_photo`다. `quest_receipt`와 `quest_photo`는 `questInstanceId`가 필요하다.

2. 응답의 `url`, `headers`, `objectKey`를 사용해 브라우저가 Object Storage로 직접 업로드한다.

```javascript
await fetch(upload.url, {
  method: upload.method,
  headers: upload.headers,
  body: file,
});
```
3. 퀘스트 완료 요청에 `photoRef`로 `objectKey`를 포함한다.

```json
{
  "latitude": 36.3275,
  "longitude": 127.4273,
  "accuracyMeters": 20,
  "photoAttached": true,
  "photoRef": "users/usr_example/quests/uqi_example/evidence/quest_receipt/....jpg"
}
```

4. 과거 수행 내역 조회나 SNS 공유 직전에는 저장된 `photoRef`를 사용해 다운로드 URL을 요청한다.

```http
POST /api/object-storage/download-url
Authorization: Bearer <access_token>
Content-Type: application/json

{
  "objectKey": "users/usr_example/quests/uqi_example/evidence/quest_receipt/....jpg"
}
```

서버는 현재 사용자 prefix 밖의 객체 키에 대해서는 URL을 발급하지 않는다.

## 운영 주의사항

- 영수증 OCR에는 금액, 카드번호, 승인번호 같은 민감 필드가 포함될 수 있으므로 OCR 결과 저장 정책을 별도로 제한한다.
- 버킷은 공개하지 않는다. 공개 공유가 필요하면 장기 공개 ACL 대신 만료형 URL 또는 서버가 생성한 공유 이미지 사본을 사용한다.
- Access Key와 Secret Key는 Git, 문서, 로그에 남기지 않는다.
- 운영 Sub Account는 가능하면 해당 버킷의 필요한 작업만 허용한다.
- presigned URL 만료 시간은 기본 600초이며, 발표 데모에서는 짧게 유지한다.
