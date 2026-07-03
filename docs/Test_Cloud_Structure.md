# 전체 인프라

| 종류 | Name | Public IP | Private IP | Subnet | ACG |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Server | qbook-bastion | 223.130.132.111 | 10.0.30.100 | qbook-webtest-subnet(10.0.30.0/24) | questbook-default-acg |
| Server | qbook-app | - | 10.0.20.100 | qbook-app-subnet(10.0.20.0/24) | questbook-default-acg |
| Server | qbook-web | - | 10.0.10.100 | qbook-web-subnet(10.0.10.0/24) | questbook-default-acg |
| Load Balancer | qbook-private-lb | - | 10.0.250.6 | qbook-privatelb-subnet(10.0.250.0/24) | |
| Load Balancer | qbook-public-lb | 101.79.28.118 | 10.0.250.6 | qbook-publiclb-subnet(10.0.255.0/24) | |
| DB | qbook-db(서비스 이름), qbook-postgre-*(서버 이름) | - | 10.0.100.6 | qbook-db-subnet(10.0.100.0/24) | cloud-postgresql-2cyi74 |
| Redis | qbook-cache(서비스 이름) | - | - | qbook-db-subnet(10.0.100.0/24) | cloud-cache-2cyidt |
| NAT Gateway | qbook-api-natgt | 101.79.16.126 | 10.0.200.6 | qbook-natgt-subnet(10.0.200.0/24) | - |
