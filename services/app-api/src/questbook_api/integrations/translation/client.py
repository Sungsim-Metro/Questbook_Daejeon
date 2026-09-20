# NAVER Papago(NCP) 번역 호출과 결과 캐시를 담당한다.
from __future__ import annotations

import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import redis

from questbook_api.infrastructure.cache import key_part
from questbook_api.settings import AppSettings

# 변수 의미: Papago 번역 API 호출 URL이다.
PAPAGO_INVOKE_URL = "https://naveropenapi.apigw.ntruss.com/nmt/v1/translation"
# 변수 의미: 지원하는 번역 대상 언어다. 국문+영문만 지원하므로 영문만 둔다.
PAPAGO_LANGUAGE_CODES = {"eng": "en"}
# 변수 의미: 번역 기능이 켜져 있으려면 필요한 환경 변수 목록이다.
REQUIRED_TRANSLATION_ENV = ["NCP_PAPAGO_CLIENT_ID", "NCP_PAPAGO_CLIENT_SECRET"]
# 변수 의미: 번역 결과 캐시 키 접두어다.
CACHE_KEY_PREFIX = "questbook:translation"
# 변수 의미: Redis 연결/응답 대기 제한 시간 초 단위 값이다.
REDIS_TIMEOUT_SECONDS = 2


class TranslationClient:
    """
    입력: 앱 설정.
    출력: 국문 텍스트를 영문으로 번역하는 클라이언트.
    역할: TourAPI에 해당 언어 데이터가 없을 때 국문 설명을 기계번역으로 대체한다.
    호출 예시: client = TranslationClient(settings); text, translated = client.translate_description("126508", "설명", "eng")
    """

    def __init__(self, settings: AppSettings) -> None:
        self.settings = settings
        self._redis = redis.Redis.from_url(
            settings.redis_url,
            decode_responses=True,
            socket_connect_timeout=REDIS_TIMEOUT_SECONDS,
            socket_timeout=REDIS_TIMEOUT_SECONDS,
        )

    def is_configured(self) -> bool:
        """
        입력: 없음.
        출력: Papago 클라이언트 ID/Secret이 모두 설정됐는지 여부.
        역할: 설정이 없을 때 조용히 원문을 그대로 쓰도록 호출부가 미리 확인한다.
        호출 예시: if client.is_configured(): ...
        """
        return bool(self.settings.translation_client_id and self.settings.translation_client_secret)

    def status(self) -> dict[str, Any]:
        """
        입력: 없음.
        출력: 헬스체크에 노출해도 안전한 설정 상태 딕셔너리.
        역할: 비밀 값 없이 설정 여부만 확인할 수 있게 한다.
        호출 예시: payload = client.status()
        """
        missing_env = [
            name
            for name, value in {
                "NCP_PAPAGO_CLIENT_ID": self.settings.translation_client_id,
                "NCP_PAPAGO_CLIENT_SECRET": self.settings.translation_client_secret,
            }.items()
            if not value
        ]
        return {
            "configured": self.is_configured(),
            "provider": "ncp_papago",
            "clientIdConfigured": bool(self.settings.translation_client_id),
            "clientSecretConfigured": bool(self.settings.translation_client_secret),
            "timeoutSeconds": self.settings.translation_timeout_seconds,
            "requiredEnv": REQUIRED_TRANSLATION_ENV,
            "missingEnv": missing_env,
        }

    def translate_description(self, content_id: str, text: str, target_language: str) -> tuple[str, bool]:
        """
        입력: 캐시 키로 쓸 콘텐츠 식별자, 번역할 국문 원문, 목표 언어 코드.
        출력: (표시할 텍스트, 기계번역 적용 여부) 튜플.
        역할: 캐시를 먼저 확인하고, 없으면 Papago를 호출하되 실패해도 원문을 안전하게 반환한다.
        호출 예시: text, translated = client.translate_description("126508", "설명입니다.", "eng")
        """
        if not text or target_language not in PAPAGO_LANGUAGE_CODES:
            return text, False

        cache_key = f"{CACHE_KEY_PREFIX}:{key_part(content_id)}:{target_language}"
        try:
            cached = self._redis.get(cache_key)
        except redis.RedisError:
            cached = None
        if cached:
            return cached, True

        if not self.is_configured():
            return text, False

        try:
            translated = self._call_papago(text, target_language)
        except (HTTPError, URLError, TimeoutError, ValueError, json.JSONDecodeError, KeyError):
            return text, False

        if not translated:
            return text, False

        try:
            self._redis.set(cache_key, translated, ex=self.settings.translation_cache_ttl_seconds)
        except redis.RedisError:
            pass
        return translated, True

    def _call_papago(self, text: str, target_language: str) -> str:
        """
        입력: 번역할 국문 원문과 목표 언어 코드.
        출력: Papago가 반환한 번역 텍스트.
        역할: NCP APIGW 인증 헤더로 Papago 번역 API를 직접 호출한다.
        호출 예시: translated = self._call_papago("설명입니다.", "eng")
        """
        request_body = urlencode(
            {"source": "ko", "target": PAPAGO_LANGUAGE_CODES[target_language], "text": text}
        ).encode("utf-8")
        request = Request(
            PAPAGO_INVOKE_URL,
            data=request_body,
            headers={
                "Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
                "X-NCP-APIGW-API-KEY-ID": self.settings.translation_client_id,
                "X-NCP-APIGW-API-KEY": self.settings.translation_client_secret,
            },
            method="POST",
        )
        with urlopen(request, timeout=self.settings.translation_timeout_seconds) as response:
            response_body = response.read()
        payload = json.loads(response_body.decode("utf-8"))
        return str(payload["message"]["result"]["translatedText"]).strip()
