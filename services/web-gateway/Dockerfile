# Questbook web-gateway 컨테이너 이미지. 표준 라이브러리만 사용한다.
FROM python:3.11-slim

WORKDIR /app

# gateway.py는 REPOSITORY_ROOT(/app) 기준으로 apps/user-web 정적 파일을 찾는다.
COPY services/web-gateway/gateway.py /app/services/web-gateway/gateway.py
COPY apps/user-web/public /app/apps/user-web/public
COPY apps/user-web/src /app/apps/user-web/src

EXPOSE 8000
CMD ["python", "/app/services/web-gateway/gateway.py"]
