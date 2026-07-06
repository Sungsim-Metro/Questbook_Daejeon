# 아카이브된 정적 프로토타입 (static MVP)

이 디렉토리는 baseline 분리 구현(`apps/user-web`, `services/*`) 이전의 초기 정적 프로토타입이다.
목업 데이터(`assets/js/mock-data.js`) 기반으로 홈, 지도, 퀘스트, 수첩, 뱃지 화면을 렌더링한다.
참조와 데모 목적으로 보존하며, 현재 사용자 대면 구현의 기준은 `apps/user-web`이다.

## 실행

리포지토리 루트에서:

```bash
cp .env.example .env
uv run python legacy/static-mvp/server.py
```

`server.py`는 이 디렉토리를 정적 루트로 제공하고, 리포지토리 루트의 `.env`에서 NAVER Maps 키를 읽는다.
접속 주소는 `http://127.0.0.1:8000/index.html`이다. 키가 없으면 지도는 목업 지도로 fallback한다.
