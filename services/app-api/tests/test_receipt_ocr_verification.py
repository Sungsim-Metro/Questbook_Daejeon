# Questbook 영수증 OCR 요구사항 검증 함수를 확인한다.
from __future__ import annotations

from pathlib import Path
import sys
import unittest


# 변수 의미: 테스트에서 앱 API 패키지를 import하기 위한 src 경로다.
APP_API_SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(APP_API_SRC))

from questbook_api.application.baseline_service import (  # noqa: E402
    evaluate_quest_receipt_requirements,
    extract_required_receipt_items,
)


class ReceiptOcrVerificationTest(unittest.TestCase):
    """
    입력: unittest 실행 컨텍스트.
    출력: 영수증 OCR 요구사항 검증 결과.
    역할: 소비형 퀘스트의 상호명, 품목, 시간 보조 검증 규칙을 확인한다.
    호출 예시: uv run pytest tests/test_receipt_ocr_verification.py
    """

    def test_extracts_item_from_sungsimdang_quest_title(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: "성심당에 가서 튀김 소보로 사먹기" 제목에서 구매 품목을 추출한다.
        호출 예시: self.test_extracts_item_from_sungsimdang_quest_title()
        """
        # 변수 의미: 퀘스트 제목에서 추출한 품목 목록이다.
        items = extract_required_receipt_items("성심당에 가서 튀김 소보로 사먹기", "", "성심당")

        self.assertEqual(items, ["튀김 소보로"])

    def test_receipt_text_matches_store_item_and_time(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: OCR 텍스트가 상호명, 품목, 영수증 시간을 모두 포함하면 통과하는지 확인한다.
        호출 예시: self.test_receipt_text_matches_store_item_and_time()
        """
        # 변수 의미: OCR에서 추출됐다고 가정한 영수증 텍스트다.
        receipt_text = "성심당 본점\n2026.07.10 13:20\n튀김 소보로 1개 1,700"

        # 변수 의미: 영수증 OCR 요구사항 검증 결과다.
        result = evaluate_quest_receipt_requirements(
            "성심당 본점",
            "성심당에 가서 튀김 소보로 사먹기",
            "영수증으로 튀김 소보로 구매 시간과 품목을 확인합니다.",
            receipt_text,
        )

        self.assertTrue(result["passed"])
        self.assertEqual(result["matchedItems"], ["튀김 소보로"])
        self.assertEqual(result["missingItems"], [])

    def test_receipt_text_reports_missing_item(self) -> None:
        """
        입력: 없음.
        출력: 없음.
        역할: 영수증에 요구 품목이 없으면 누락 품목을 보고하는지 확인한다.
        호출 예시: self.test_receipt_text_reports_missing_item()
        """
        # 변수 의미: 품목이 맞지 않는 OCR 텍스트다.
        receipt_text = "성심당 본점\n2026.07.10 13:20\n부추빵 1개 2,000"

        # 변수 의미: 영수증 OCR 요구사항 검증 결과다.
        result = evaluate_quest_receipt_requirements(
            "성심당 본점",
            "성심당에 가서 튀김 소보로 사먹기",
            "",
            receipt_text,
        )

        self.assertFalse(result["passed"])
        self.assertEqual(result["missingItems"], ["튀김 소보로"])


if __name__ == "__main__":
    unittest.main()
