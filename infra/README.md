# 인프라 디렉토리

로컬 개발과 NCP 배포 구성을 보관한다.

- `local/`: 로컬 개발용 실행 구성
- `ncp/`: VPC, subnet, 로드 밸런서, 웹 서버, 앱 서버, PostgreSQL, Redis, NAT Gateway 구성
- `nginx/`: 정적 파일 제공과 `/api` 프록시 설정

설계서 기준 baseline은 웹 서버 1대, 앱 서버 1대, 관리형 PostgreSQL 1대, Redis 1대이다. 앱 서버가 2대 이상으로 늘어날 때도 같은 Redis 캐시를 공유하고, Redis 용량이나 배치 확장은 별도로 검토한다.
