# 네이버와 구글 OAuth 인가 URL 구성, 코드 교환, 프로필 조회를 담당한다.
from __future__ import annotations

import json
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen


# 변수 의미: 외부 OAuth 엔드포인트 응답 제한 시간 초 단위 값이다.
OAUTH_TIMEOUT_SECONDS = 8

# 변수 의미: provider별 OAuth 엔드포인트와 scope 설정이다.
PROVIDERS: dict[str, dict[str, str | None]] = {
    "naver": {
        "authorize_url": "https://nid.naver.com/oauth2.0/authorize",
        "token_url": "https://nid.naver.com/oauth2.0/token",
        "profile_url": "https://openapi.naver.com/v1/nid/me",
        "scope": None,
    },
    "google": {
        "authorize_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_url": "https://oauth2.googleapis.com/token",
        "profile_url": "https://openidconnect.googleapis.com/v1/userinfo",
        "scope": "openid email profile",
    },
}


def is_supported_provider(provider: str) -> bool:
    """
    입력: provider 이름.
    출력: 지원 여부.
    역할: 알 수 없는 provider 요청을 조기에 거른다.
    호출 예시: if not is_supported_provider("naver"): ...
    """
    return provider in PROVIDERS


def build_authorize_url(provider: str, client_id: str, state: str, redirect_uri: str) -> str:
    """
    입력: provider 이름, client ID, state, redirect_uri.
    출력: 사용자 브라우저가 이동할 인가 URL.
    역할: provider별 인가 요청 쿼리를 구성한다.
    호출 예시: url = build_authorize_url("naver", client_id, state, redirect_uri)
    """
    if not is_supported_provider(provider):
        raise ValueError(f"unsupported provider: {provider}")
    # 변수 의미: 인가 요청 공통 쿼리 파라미터다.
    params = {"response_type": "code", "client_id": client_id, "redirect_uri": redirect_uri, "state": state}
    # 변수 의미: provider 설정에 정의된 scope다.
    scope = PROVIDERS[provider]["scope"]
    if scope:
        params["scope"] = scope
    return f"{PROVIDERS[provider]['authorize_url']}?{urlencode(params)}"


def _post_form(url: str, params: dict[str, str]) -> dict[str, Any]:
    """
    입력: 요청 URL과 폼 파라미터.
    출력: JSON으로 파싱한 응답 딕셔너리.
    역할: OAuth 토큰 교환용 x-www-form-urlencoded POST를 보낸다.
    호출 예시: data = _post_form(token_url, params)
    """
    # 변수 의미: 폼 인코딩한 요청 본문 바이트다.
    body = urlencode(params).encode("utf-8")
    # 변수 의미: 준비된 토큰 교환 요청 객체다.
    request = Request(url, data=body, headers={"Content-Type": "application/x-www-form-urlencoded"}, method="POST")
    with urlopen(request, timeout=OAUTH_TIMEOUT_SECONDS) as response:
        return json.loads(response.read().decode("utf-8"))


def _get_json(url: str, headers: dict[str, str]) -> dict[str, Any]:
    """
    입력: 요청 URL과 헤더.
    출력: JSON으로 파싱한 응답 딕셔너리.
    역할: OAuth 프로필 조회용 GET을 보낸다.
    호출 예시: data = _get_json(profile_url, {"Authorization": "Bearer x"})
    """
    # 변수 의미: 준비된 프로필 조회 요청 객체다.
    request = Request(url, headers=headers, method="GET")
    with urlopen(request, timeout=OAUTH_TIMEOUT_SECONDS) as response:
        return json.loads(response.read().decode("utf-8"))


def _required_string(data: dict[str, Any], name: str, error_message: str) -> str:
    """
    입력: 응답 딕셔너리, 필드 이름, 오류 메시지.
    출력: 앞뒤 공백을 제거한 필수 문자열 값.
    역할: None이나 숫자가 provider 식별자 또는 토큰으로 통과하지 않게 한다.
    호출 예시: access_token = _required_string(data, "access_token", "missing token")
    """
    # 변수 의미: 응답에서 읽은 원본 필드 값이다.
    value = data.get(name)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(error_message)
    return value.strip()


def _token_params(provider: str, client_id: str, client_secret: str, code: str, state: str, redirect_uri: str) -> dict[str, str]:
    """
    입력: provider, client ID/secret, 인가 코드, state, redirect_uri.
    출력: provider별 토큰 교환 폼 파라미터.
    역할: Google과 Naver의 토큰 요청 필드 차이를 분리한다.
    호출 예시: params = _token_params("google", cid, secret, code, state, redirect_uri)
    """
    # 변수 의미: 토큰 교환 공통 요청 파라미터다.
    params = {
        "grant_type": "authorization_code",
        "client_id": client_id,
        "client_secret": client_secret,
        "code": code,
    }
    if provider == "naver":
        params["state"] = state
    else:
        params["redirect_uri"] = redirect_uri
    return params


def _validate_token_response(provider: str, data: dict[str, Any]) -> str:
    """
    입력: provider 이름과 토큰 응답 딕셔너리.
    출력: 검증된 provider access token.
    역할: OAuth 오류 응답과 잘못된 token_type/access_token을 차단한다.
    호출 예시: access_token = _validate_token_response("google", data)
    """
    if data.get("error"):
        raise ValueError("oauth token exchange failed")
    # 변수 의미: 응답에서 꺼낸 token_type 값이다.
    token_type = data.get("token_type", "Bearer")
    if not isinstance(token_type, str) or token_type.lower() != "bearer":
        raise ValueError("oauth token response did not return bearer token")
    return _required_string(data, "access_token", "oauth token exchange did not return access_token")


def exchange_code(
    provider: str,
    client_id: str,
    client_secret: str,
    code: str,
    state: str,
    redirect_uri: str,
) -> str:
    """
    입력: provider, client ID/secret, 인가 코드, state, redirect_uri.
    출력: provider access token 문자열.
    역할: 인가 코드를 access token으로 교환한다.
    호출 예시: token = exchange_code("naver", cid, secret, code, state, redirect_uri)
    """
    if not is_supported_provider(provider):
        raise ValueError(f"unsupported provider: {provider}")
    # 변수 의미: 토큰 교환 요청 파라미터다.
    params = _token_params(provider, client_id, client_secret, code, state, redirect_uri)
    # 변수 의미: provider 토큰 응답이다.
    data = _post_form(str(PROVIDERS[provider]["token_url"]), params)
    return _validate_token_response(provider, data)


def fetch_profile(provider: str, access_token: str) -> dict[str, str]:
    """
    입력: provider와 access token.
    출력: provider_user_id, email, display_name을 담은 딕셔너리.
    역할: provider 프로필 응답을 공통 형태로 정규화한다.
    호출 예시: profile = fetch_profile("naver", access_token)
    """
    if not is_supported_provider(provider):
        raise ValueError(f"unsupported provider: {provider}")
    # 변수 의미: provider 프로필 원본 응답이다.
    data = _get_json(str(PROVIDERS[provider]["profile_url"]), {"Authorization": f"Bearer {access_token}"})
    if provider == "naver":
        # 변수 의미: 네이버 프로필 본문이다(response 안에 사용자 정보가 들어 있다).
        profile = data.get("response", {}) if isinstance(data.get("response"), dict) else {}
        return {
            "provider_user_id": _required_string(profile, "id", "naver profile did not return id"),
            "email": profile["email"].strip() if isinstance(profile.get("email"), str) else "",
            "display_name": (
                profile["nickname"].strip()
                if isinstance(profile.get("nickname"), str) and profile["nickname"].strip()
                else profile["name"].strip() if isinstance(profile.get("name"), str) else ""
            ),
        }

    # 변수 의미: Google OpenID Connect userinfo 응답을 공통 프로필로 바꾼 값이다.
    return {
        "provider_user_id": _required_string(data, "sub", "google profile did not return sub"),
        "email": data["email"].strip() if isinstance(data.get("email"), str) else "",
        "display_name": data["name"].strip() if isinstance(data.get("name"), str) else "",
    }
