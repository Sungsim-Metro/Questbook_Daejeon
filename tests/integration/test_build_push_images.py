# build_push_images의 태그 계산 로직을 검증한다.
from __future__ import annotations

import sys
from pathlib import Path


# 변수 의미: 저장소 스크립트 디렉터리를 import 경로에 추가한다.
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

from build_push_images import image_refs


def test_image_refs_builds_sha_and_latest_tags() -> None:
    """
    입력: 레지스트리 주소와 짧은 커밋 해시.
    출력: 이미지별 sha/latest 태그 목록 검증 결과.
    역할: web/app 이미지 참조가 배포 스크립트 계약대로 만들어지는지 확인한다.
    호출 예시: uv run --project services/app-api pytest tests/integration/test_build_push_images.py -v
    """
    # 변수 의미: 테스트용 레지스트리와 커밋 해시로 생성한 이미지 참조 목록이다.
    refs = image_refs("questbook.kr.ncr.ntruss.com", "abc1234")

    assert refs == {
        "qbook-web": [
            "questbook.kr.ncr.ntruss.com/qbook-web:abc1234",
            "questbook.kr.ncr.ntruss.com/qbook-web:latest",
        ],
        "qbook-app": [
            "questbook.kr.ncr.ntruss.com/qbook-app:abc1234",
            "questbook.kr.ncr.ntruss.com/qbook-app:latest",
        ],
    }


def test_image_refs_strips_trailing_slash() -> None:
    """
    입력: 끝 슬래시가 붙은 레지스트리 주소와 짧은 커밋 해시.
    출력: 정규화된 이미지 참조 검증 결과.
    역할: 레지스트리 주소의 끝 슬래시가 중복 경로 구분자를 만들지 않는지 확인한다.
    호출 예시: uv run --project services/app-api pytest tests/integration/test_build_push_images.py -v
    """
    # 변수 의미: 끝 슬래시가 있는 레지스트리 주소로 생성한 이미지 참조 목록이다.
    refs = image_refs("questbook.kr.ncr.ntruss.com/", "abc1234")

    assert refs["qbook-web"][0] == "questbook.kr.ncr.ntruss.com/qbook-web:abc1234"
