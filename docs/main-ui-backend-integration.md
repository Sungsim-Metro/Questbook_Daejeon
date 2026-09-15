# main UI와 기존 백엔드 통합 기준

## 승인된 범위

2026-09-15 사용자 선택: main 디자인을 유지하고 기존 백엔드·계획 모드 기능부터 정상 연결한다.

- UI 기준: `origin/main`의 `f4d95a3`.
- 기능 기준: `planMode`의 현재 작업 트리. 미커밋 카탈로그와 스냅샷 보존 기능을 포함한다.
- 원본 작업 폴더를 변경하지 않고 `integrate/main-ui-backend` 작업 공간에서 통합한다.
- 통합 작업 폴더: `/home/ilhyeonchu/Documents/GitHub/Questbook_Dajeon-main-ui-integration`.
- 커밋·푸시·병합·운영 DB 변경은 수행하지 않는다.

## 보존할 계약

- Stitch 테마, 다섯 최상위 화면, 드로어·시트·지도·촬영의 디자인을 유지한다.
- 관심사는 기존 6개 카테고리를 사용한다. 화면의 v2 이름과 서버 코드 사이를 명시적으로 변환하며 지원하지 않는 분류를 전체 조회로 바꾸지 않는다.
- 추천 위치는 현위치와 계획 위치로 분리한다. 계획 모드에는 `mode=planning`을 전달한다. 정상 빈 결과를 예시 퀘스트로 바꾸지 않는다.
- 계획 날짜는 저장 가능한 계획 메모이며 현재 서버의 행사 필터·날씨 제공을 보장하지 않는다.
- 위치 검색은 기존 네이버 geocode 계약을 사용한다. 주요 지점·좌표·지도 위치 설정 및 GPS 없는 관심 관광지 탐색을 보존한다.
- 완료 인증에는 실제 GPS만 사용한다. 사진·OCR·체크리스트는 현재 서버의 보조 검증 정책을 따른다.
- 보상은 기존 카테고리 XP·뱃지·꿈돌이 해금 정책을 유지한다. 도감·보상 연출·촬영 권한은 서버 획득 결과에서만 결정한다.
- 닉네임과 대표 꿈돌이는 인증된 사용자 기준으로 저장하며 보유하지 않은 꿈돌이 선택은 서버에서 거부한다.
- OAuth는 기존 계정 로그인이다. 체험 계정 기록을 소셜 계정으로 병합했다는 표시를 하지 않는다. 체험 계정은 독립 게스트라고 안내하지 않는다.
- 수첩은 기존 `entryType`, `title`, `body`, `rating` 계약을 사용한다.
- 계정 변경 및 모드·위치 변경 전의 지연 응답은 최신 화면 상태를 덮지 않는다.

## 이번 범위에 포함하지 않는 정책

퀘스트별 1:1 고유 보상, 독립 게스트와 계정 병합, 축제 회차별 보상, 날씨 제공 및 계정 영구 삭제는 별도 확장이다. 해당 기능은 완료·지급·저장이 성공한 것처럼 표시하지 않는다. v2 보상 마이그레이션을 실행하지 않는다.

## 검증

- 프론트 회귀: 모드 왕복·위치 검색·관심사 저장·정상 빈 목록·지연 응답·계정 전환·수첩 저장·실제 보상·저장 실패.
- 백엔드: 기존 API/카탈로그/스냅샷 테스트 및 닉네임·대표 선택의 인증·소유권·영속성 검사.
- 화면: 390px와 1280px, 메뉴·뒤로가기·키보드·계획 설정·도감·수첩.
- 실제 운영 자격 증명 없이 테스트 전용 PostgreSQL/Redis 및 가짜 외부 응답을 사용한다.

## 적용 방법

통합 변경은 별도 `integrate/main-ui-backend` 브랜치의 미커밋 작업으로 제공한다. 운영 서비스에는 아직 적용하지 않았다. 검토 후 이 소스를 사용할 배포 작업 폴더에서 실행한다.

```bash
docker compose up -d --build app catalog-sync web
```

`app`과 `catalog-sync`는 같은 API 이미지를 사용하므로 함께 갱신한다. `web`은 프론트 파일을 이미지에 포함하므로 재빌드해야 한다. 기존 데이터 볼륨은 유지하며 v2 고유 보상 제안 SQL은 실행하지 않는다.

개발용 볼륨 마운트 환경을 처음 구성하거나 이미지를 갱신할 때는 다음 명령을 사용한다.

```bash
docker compose -f docker-compose.yaml -f docker-compose.dev.yaml up -d --build app catalog-sync web
```

이후 정적 프론트 파일 변경은 새 요청부터 반영된다. PWA 업데이트 안내가 나타나면 업데이트를 적용한다. Python 소스 변경에는 같은 Compose 파일 조합으로 `restart app catalog-sync web`이 필요하며, 환경 변수 변경에는 `up -d --force-recreate app catalog-sync web`을 사용한다.

## 확인된 결과

- 테스트 전용 PostgreSQL/Redis에서 백엔드 및 HTTP smoke 226개 테스트와 83개 하위 검사가 통과했다.
- 프론트 계약·세션 경쟁·저장 실패·모드 복원·지도 빈 결과 등 22개 회귀 검사가 통과했다. 실제 등록된 Escape 이벤트 처리기도 검사했다.
- JavaScript 문법 검사, 정적 배포 빌드, HTML의 로컬 자산 참조 및 `git diff --check`가 통과했다. CSS와 이미지 자산은 main과 동일하다. HTML과 서비스워커의 릴리스 버전은 `20260915-integration-5`로 일치한다.
- 실제 테스트 gateway에서 계획 추천·수락·GPS 완료 검증과 대표 선택 영속성을 확인했다. 계획 좌표와 다른 원격 위치로 완료를 요청하면 거부되었다.
- 브라우저에서 닉네임·관심사·수첩 일기 저장 후 새로고침해도 데이터가 유지되는 것을 확인했다.
- 390px 모바일과 1280px 데스크톱 크기에서 메뉴·계획 위치·관광지 이동·도감을 확인했다. 정상 빈 계획 결과에서는 목록·지도 마커·선택 상세 모두 예시 퀘스트를 표시하지 않는다. 데스크톱 페이지의 가로 넘침은 없었다.
- 대표 꿈돌이 저장 후 재조회, 미보유 도감 잠금, PWA 업데이트 안내와 새 버전 적용을 확인했다. 메뉴의 닫기 버튼과 Tab/Shift+Tab 포커스 순환·복귀를 확인했다.
- 검수 브라우저는 Escape를 단순 진단 페이지에도 전달하지 않았으므로 실제 Escape 키 입력의 화면 검증은 제한되었다. 최종 화면 캡처 일부도 브라우저 도구 시간 초과로 얻지 못했으며, 해당 화면은 접근성 트리와 DOM 크기를 확인했다. 실제 브라우저에서 Escape 닫기는 추가 확인 대상이다.
- 통합에 가져온 원본 파일 28개는 복사 시 기록한 SHA-256과 모두 일치한다.
- 실제 OAuth 로그인, 외부 지도 SDK, TourAPI 실서비스 및 사진 업로드·OCR의 외부 연동은 운영 자격 증명 없이 수행한 이번 검증에 포함되지 않는다.

프론트 검사는 저장소 루트에서 다음과 같이 재실행한다.

```bash
node --check apps/user-web/src/app.js
node --check apps/user-web/public/service-worker.js
node --test apps/user-web/tests/test_main_integration.mjs
bash scripts/build-static-site.sh
git diff --check
```

백엔드는 Python 3.11 환경에서 기존 테스트 안내에 따라 테스트 전용 `QUESTBOOK_TEST_ADMIN_DATABASE_URL`, `QUESTBOOK_TEST_DATABASE_URL`, `QUESTBOOK_TEST_REDIS_URL`을 설정한 뒤 실행한다.

```bash
uv sync --project services/app-api --frozen --python 3.11
uv run --project services/app-api pytest services/app-api/tests tests/smoke -q
```
