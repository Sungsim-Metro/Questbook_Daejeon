# Questbook baseline stateless 인증 토큰을 발급하고 검증한다.
from __future__ import annotations

import base64
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json
from typing import Any


def base64url_encode(raw_bytes: bytes) -> str:
    """
    입력: 원본 바이트.
    출력: JWT 호환 base64url 문자열.
    역할: padding 없는 URL 안전 인코딩을 수행한다.
    호출 예시: encoded = base64url_encode(b\"payload\")
    """
    return base64.urlsafe_b64encode(raw_bytes).rstrip(b"=").decode("ascii")


def base64url_decode(raw_value: str) -> bytes:
    """
    입력: padding 없는 base64url 문자열.
    출력: 디코딩된 바이트.
    역할: 토큰 header와 payload를 JSON으로 복원할 수 있게 한다.
    호출 예시: raw = base64url_decode(encoded)
    """
    # 변수 의미: base64 padding 길이를 맞춘 문자열이다.
    padded_value = raw_value + "=" * (-len(raw_value) % 4)
    return base64.urlsafe_b64decode(padded_value.encode("ascii"))


def sign_token_part(signing_input: str, secret: str) -> str:
    """
    입력: 서명 대상 문자열과 비밀 키.
    출력: HMAC-SHA256 서명 문자열.
    역할: 토큰 위조 여부를 검증할 수 있는 서명을 만든다.
    호출 예시: signature = sign_token_part(signing_input, secret)
    """
    # 변수 의미: HMAC-SHA256 서명 바이트다.
    signature = hmac.new(secret.encode("utf-8"), signing_input.encode("ascii"), hashlib.sha256).digest()
    return base64url_encode(signature)


def create_access_token(user_id: str, provider: str, secret: str, expires_minutes: int = 120) -> str:
    """
    입력: 사용자 ID, provider 이름, 서명 키, 만료 시간.
    출력: Authorization Bearer에 사용할 서명 토큰.
    역할: 서버 측 세션 저장소 없이 사용자 신원을 전달한다.
    호출 예시: token = create_access_token(\"demo-user\", \"demo-social\", secret)
    """
    # 변수 의미: 토큰 헤더다.
    header = {"alg": "HS256", "typ": "JWT"}
    # 변수 의미: 현재 UTC 시각이다.
    now = datetime.now(timezone.utc)
    # 변수 의미: 토큰 payload다.
    payload = {
        "sub": user_id,
        "provider": provider,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=expires_minutes)).timestamp()),
    }
    # 변수 의미: 인코딩된 header다.
    encoded_header = base64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8"))
    # 변수 의미: 인코딩된 payload다.
    encoded_payload = base64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
    # 변수 의미: 서명 대상 문자열이다.
    signing_input = f"{encoded_header}.{encoded_payload}"
    return f"{signing_input}.{sign_token_part(signing_input, secret)}"


def verify_access_token(token: str, secret: str) -> dict[str, Any]:
    """
    입력: Bearer 토큰 문자열과 서명 키.
    출력: 검증된 payload 딕셔너리.
    역할: 서명과 만료 시간을 확인해 신뢰 가능한 사용자 신원을 추출한다.
    호출 예시: payload = verify_access_token(token, secret)
    """
    # 변수 의미: 토큰을 구성하는 세 부분이다.
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("invalid token shape")

    # 변수 의미: 서명 대상 문자열이다.
    signing_input = f"{parts[0]}.{parts[1]}"
    # 변수 의미: 기대 서명 문자열이다.
    expected_signature = sign_token_part(signing_input, secret)
    if not hmac.compare_digest(expected_signature, parts[2]):
        raise ValueError("invalid token signature")

    # 변수 의미: JSON으로 복원한 payload다.
    payload = json.loads(base64url_decode(parts[1]).decode("utf-8"))
    # 변수 의미: 현재 Unix timestamp다.
    now_timestamp = int(datetime.now(timezone.utc).timestamp())
    if int(payload.get("exp", 0)) <= now_timestamp:
        raise ValueError("expired token")
    if not payload.get("sub"):
        raise ValueError("missing subject")
    return payload
