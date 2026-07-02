# 앱 API 서비스

Python 앱 서버 구현 위치이다. 설계서의 앱 서버 계층에 해당하며, 외부 API 호출, Redis 임시 캐시, 추천 점수 계산, 퀘스트 생성과 완료 처리를 담당한다.

## 구조

```text
src/questbook_api/
  api/             HTTP 라우트와 요청/응답 계약
  application/     유스케이스 조합 로직
  domain/          설계서의 핵심 모델과 정책
  infrastructure/  PostgreSQL, Redis, 파일 저장소, 트랜잭션
  integrations/    TourAPI, NAVER Maps, Gemini, OAuth
  observability/   로그, 헬스체크, 지표
tests/             앱 API 테스트
```

## 우선 구현 대상

1. 헬스체크와 설정 로딩
2. TourAPI 클라이언트
3. 유저 단위 Redis 30분 임시 캐시
4. 추천 점수 계산
5. `ReusableQuest` 재사용 매칭
6. `UserQuestInstance` 생성
7. 퀘스트 완료 트랜잭션

OpenAPI 원본 응답 전체를 PostgreSQL에 저장하지 않고, `contentId`와 표시명 같은 최소 참조값만 공용 퀘스트 자산에 남긴다. 현재 SQLite/인메모리 baseline 구현은 PostgreSQL/Redis 연결 계층으로 교체할 예정이다.
