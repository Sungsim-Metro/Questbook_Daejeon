# NCP CLOVA OCR 호출과 응답 텍스트 정규화를 담당한다.
from __future__ import annotations

import json
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import uuid4

from questbook_api.settings import AppSettings


# 변수 의미: Questbook OCR 연동에 필요한 환경 변수 이름 목록이다.
REQUIRED_OCR_ENV = ["NCP_CLOVA_OCR_INVOKE_URL", "NCP_CLOVA_OCR_SECRET_KEY"]
# 변수 의미: 파일 확장자나 Content-Type에서 OCR API format으로 변환할 값이다.
OCR_IMAGE_FORMAT_ALIASES = {
    "jpeg": "jpg",
    "jpg": "jpg",
    "png": "png",
    "webp": "webp",
    "heic": "heic",
    "heif": "heif",
}


def normalize_ocr_image_format(value: str, fallback: str = "jpg") -> str:
    """
    입력: 이미지 Content-Type, 파일 확장자, 또는 객체 키.
    출력: CLOVA OCR images.format 값.
    역할: 브라우저 업로드 메타데이터를 OCR 요청 형식에 맞춘다.
    호출 예시: image_format = normalize_ocr_image_format("image/jpeg")
    """
    # 변수 의미: 입력값에서 format 후보만 뽑기 위한 소문자 문자열이다.
    normalized = value.strip().lower()
    if "/" in normalized:
        normalized = normalized.rsplit("/", 1)[-1]
    if "." in normalized:
        normalized = normalized.rsplit(".", 1)[-1]
    return OCR_IMAGE_FORMAT_ALIASES.get(normalized, fallback)


def extract_text_lines(ocr_payload: dict[str, Any]) -> list[str]:
    """
    입력: CLOVA OCR 원본 응답 JSON.
    출력: 인식된 텍스트 라인 목록.
    역할: images[].fields[].inferText 구조에서 비교 가능한 텍스트만 추출한다.
    호출 예시: lines = extract_text_lines(payload)
    """
    # 변수 의미: 추출한 OCR 텍스트 라인 목록이다.
    lines: list[str] = []
    for image in ocr_payload.get("images", []):
        if not isinstance(image, dict):
            continue
        for field in image.get("fields", []):
            if not isinstance(field, dict):
                continue
            # 변수 의미: OCR 필드의 추론 텍스트다.
            infer_text = str(field.get("inferText") or "").strip()
            if infer_text:
                lines.append(infer_text)
    return lines


class OcrClient:
    """
    입력: 앱 설정.
    출력: NCP CLOVA OCR 호출 클라이언트.
    역할: OCR secret을 서버에만 보관하고 사진 URL에서 텍스트를 추출한다.
    호출 예시: client = OcrClient(settings)
    """

    def __init__(self, settings: AppSettings) -> None:
        """
        입력: 앱 설정.
        출력: 없음.
        역할: OCR 접속 설정을 보관한다.
        호출 예시: client = OcrClient(settings)
        """
        # 변수 의미: 앱 API 실행 설정이다.
        self.settings = settings

    def is_configured(self) -> bool:
        """
        입력: 없음.
        출력: OCR 필수 설정 완료 여부.
        역할: Invoke URL과 Secret Key가 모두 준비됐는지 확인한다.
        호출 예시: if client.is_configured(): ...
        """
        return bool(self.settings.ocr_invoke_url and self.settings.ocr_secret_key)

    def status(self) -> dict[str, Any]:
        """
        입력: 없음.
        출력: 비밀 값을 제외한 OCR 설정 상태.
        역할: 헬스체크와 프런트 설정 확인에서 secret 노출 없이 준비 상태를 보여준다.
        호출 예시: payload = client.status()
        """
        # 변수 의미: 아직 채워지지 않은 필수 환경 변수 이름 목록이다.
        missing_env = [
            name
            for name, value in {
                "NCP_CLOVA_OCR_INVOKE_URL": self.settings.ocr_invoke_url,
                "NCP_CLOVA_OCR_SECRET_KEY": self.settings.ocr_secret_key,
            }.items()
            if not value
        ]
        return {
            "configured": self.is_configured(),
            "provider": "ncp_clova_ocr",
            "invokeUrlConfigured": bool(self.settings.ocr_invoke_url),
            "secretKeyConfigured": bool(self.settings.ocr_secret_key),
            "language": self.settings.ocr_language,
            "timeoutSeconds": self.settings.ocr_timeout_seconds,
            "requiredEnv": REQUIRED_OCR_ENV,
            "missingEnv": missing_env,
        }

    def extract_text_from_url(self, image_url: str, image_format: str = "jpg", image_name: str = "quest_evidence") -> dict[str, Any]:
        """
        입력: OCR에서 접근 가능한 이미지 URL, 이미지 format, 이미지 이름.
        출력: OCR 원문 응답과 추출 텍스트.
        역할: presigned download URL을 CLOVA OCR에 전달하고 영수증 텍스트를 얻는다.
        호출 예시: result = client.extract_text_from_url(download_url, "jpg", "receipt")
        """
        if not self.is_configured():
            raise RuntimeError("NCP CLOVA OCR is not configured.")

        # 변수 의미: OCR 요청 이미지 format이다.
        normalized_format = normalize_ocr_image_format(image_format)
        # 변수 의미: CLOVA OCR JSON 요청 본문이다.
        request_payload = {
            "version": "V2",
            "requestId": uuid4().hex,
            "timestamp": int(time.time() * 1000),
            "lang": self.settings.ocr_language,
            "images": [
                {
                    "format": normalized_format,
                    "name": image_name,
                    "url": image_url,
                }
            ],
        }
        # 변수 의미: OCR 상위 요청 객체다.
        request = Request(
            self.settings.ocr_invoke_url,
            data=json.dumps(request_payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json; charset=utf-8",
                "X-OCR-SECRET": self.settings.ocr_secret_key,
            },
            method="POST",
        )

        try:
            with urlopen(request, timeout=self.settings.ocr_timeout_seconds) as response:
                # 변수 의미: OCR API 응답 JSON 바이트다.
                response_body = response.read()
                # 변수 의미: OCR API 응답 HTTP 상태 코드다.
                status_code = response.status
        except HTTPError as error:
            # 변수 의미: OCR API가 반환한 안전한 HTTP 상태 코드다.
            raise RuntimeError(f"OCR upstream returned HTTP {error.code}.") from error
        except URLError as error:
            raise RuntimeError(f"OCR upstream request failed: {error.reason}") from error

        try:
            # 변수 의미: 파싱된 OCR API 응답 본문이다.
            ocr_payload = json.loads(response_body.decode("utf-8"))
        except json.JSONDecodeError as error:
            raise RuntimeError("OCR upstream returned invalid JSON.") from error

        # 변수 의미: OCR 응답에서 추출한 텍스트 라인 목록이다.
        lines = extract_text_lines(ocr_payload)
        return {
            "ok": True,
            "statusCode": status_code,
            "provider": "ncp_clova_ocr",
            "imageFormat": normalized_format,
            "lines": lines,
            "text": "\n".join(lines),
            "raw": ocr_payload,
        }
