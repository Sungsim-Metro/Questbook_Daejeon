# 전체 인프라

| 종류 | Name | Public IP | Private IP | Subnet | ACG |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Server | qbook-bastion | 223.130.132.111 | 10.0.30.100 | qbook-webtest-subnet(10.0.30.0/24) | questbook-default-acg |
| Server | qbook-app | - | 10.0.20.100 | qbook-app-subnet(10.0.20.0/24) | questbook-default-acg |
| Auto Scaling Group | app-kr2 | - | 10.0.20.* | qbook-app-subnet(10.0.20.0/24) | questbook-default-acg |
| Auto Scaling Group | app-kr1 | - | 10.0.21.* | qbook-app-subnet-kr1(10.0.21.0/24) | questbook-default-acg |
| Server | qbook-web | - | 10.0.10.100 | qbook-web-subnet(10.0.10.0/24) | questbook-default-acg |
| Auto Scaling Group | web-kr2 | - | 10.0.10.* | qbook-web-subnet(10.0.10.0/24) | questbook-default-acg |
| Auto Scaling Group | web-kr1 | - | 10.0.11.* | qbook-web-subnet-kr1(10.0.11.0/24) | questbook-default-acg |
| Load Balancer | qbook-private-lb | - | 10.0.250.6 | qbook-privatelb-subnet(10.0.250.0/24), qbook-privatelb-subnet-kr1(10.0.251.0/24) | |
| Load Balancer | qbook-public-lb | 101.79.28.118, 223.130.159.44 | 10.0.255.6 | qbook-publiclb-subnet(10.0.255.0/24), qbook-publiclb-subnet-kr1(10.0.254.0/24) | |
| DB | qbook-db(서비스 이름), qbook-postgre-001-9ctp(서버 이름) | - | 10.0.100.6 | qbook-db-subnet(10.0.100.0/24) | cloud-postgresql-2cyi74 |
| DB | qbook-db(서비스 이름), qbook-postgre-002-9cza(서버 이름) | - | 10.0.101.6 | qbook-db-subnet-kr1(10.0.101.0/24) | cloud-postgresql-2cyi74 |
| Redis | qbook-cache(서비스 이름) | - | - | qbook-db-subnet(10.0.100.0/24) | cloud-cache-2cyidt |
| NAT Gateway | qbook-api-natgt | 101.79.16.126 | 10.0.200.6 | qbook-natgt-subnet(10.0.200.0/24) | - |
| NAT Gateway | qbook-api-natgt-kr1 | 101.79.28.119 | 10.0.201.6 | qbook-natgt-subnet-kr1(10.0.201.0/24) | - |

# 접근 제어 메모

- **VPC 환경의 로드밸런서(qbook-public-lb, qbook-private-lb)에는 ACG가 없다.** LB로 들어오는 트래픽의 접근 제어는 **LB 서브넷의 Network ACL**이 담당한다. 서버 계층은 ACG로, LB 계층은 NACL로 통제한다는 점을 재구축 시 유의한다.
- 서버 ACG 권장 규칙(웹 서버에서 검증됨, 앱 서버는 아래 기준으로 적용):
  - qbook-bastion: in 22 ← 관리자 IP / out 22 → 10.0.0.0/16, 80·443 → any
  - qbook-web: in 8000 ← 10.0.255.0/24(publiclb), 22 ← 10.0.30.100/32 / out 8100 → 10.0.250.0/24, 80·443 → any
  - qbook-app: in 8100 ← 10.0.250.0/24(privatelb), 22 ← 10.0.30.100/32 / out 5432·6379 → 10.0.100.0/24, 80·443 → any
  - cloud-postgresql-2cyi74: in 5432 ← 10.0.20.0/24 · cloud-cache-2cyidt: in 6379 ← 10.0.20.0/24
- Cloud DB PostgreSQL의 DB User 접근 제어(Client IP)에도 10.0.20.0/24 등록이 필요하다(ACG와 별개 계층).
- 실제 적용값이 위와 다르면 이 표를 사용자가 최종 확인 후 갱신한다.

# 서비스 상태 (2026-07-04 기준)

- 전체 경로 동작 확인: 브라우저 → Public ALB(HTTPS, www.travel-qbook.co.kr) → qbook-web 게이트웨이(:8000) → Private LB(:8100) → qbook-app API(:8100) → Cloud DB PostgreSQL/Redis
- systemd: qbook-web에 웹 게이트웨이, qbook-app에 questbook-api.service
- 앱 API 첫 기동 시 스키마 생성·seed 자동 수행(수동 마이그레이션 불필요)
- TourAPI 키 미설정 상태 → 대전 fallback 데이터로 동작(추후 TOURAPI_SERVICE_KEY 주입 가능)
