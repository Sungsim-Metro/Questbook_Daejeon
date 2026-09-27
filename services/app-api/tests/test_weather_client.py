# 날씨 클라이언트의 좌표 변환, 발표 슬롯 선택, 응답 파싱, 폴백 정책을 검증한다.
from __future__ import annotations

from pathlib import Path
from datetime import date, datetime, timedelta
import json
import sys
import unittest
from urllib.error import HTTPError, URLError
from unittest.mock import patch


# 변수 의미: 테스트에서 앱 API 패키지를 import하기 위한 src 경로다.
APP_API_SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(APP_API_SRC))

from questbook_api.integrations.weather.client import (
    KST,
    WeatherClient,
    build_outdoor_note,
    latest_valid_base_datetime,
    normalize_service_key,
    sky_pty_to_condition,
)
from questbook_api.integrations.weather.grid import latlng_to_grid


class FakeWeatherResponse:
    """
    입력: JSON 직렬화 가능한 getVilageFcst 응답 페이로드.
    출력: urlopen context manager처럼 동작하는 가짜 응답.
    역할: 네트워크 호출 없이 WeatherClient의 파싱 흐름을 검증한다.
    호출 예시: response = FakeWeatherResponse(payload)
    """

    def __init__(self, payload: dict) -> None:
        self.response_body = json.dumps(payload).encode("utf-8")

    def __enter__(self) -> "FakeWeatherResponse":
        return self

    def __exit__(self, _exc_type: object, _exc: object, _traceback: object) -> None:
        return None

    def read(self) -> bytes:
        return self.response_body


def _build_item(fcst_date: str, fcst_time: str, category: str, value: str) -> dict:
    """
    입력: 예보 날짜, 시각, 카테고리, 값.
    출력: getVilageFcst item 하나.
    역할: 테스트용 응답 항목을 짧게 만든다.
    호출 예시: _build_item("20260922", "1500", "TMP", "23")
    """
    return {
        "baseDate": fcst_date, "baseTime": fcst_time,
        "fcstDate": fcst_date, "fcstTime": fcst_time,
        "category": category, "fcstValue": value,
        "nx": 67, "ny": 100,
    }


def _success_envelope(items: list[dict]) -> dict:
    """
    입력: item 목록.
    출력: resultCode 00인 정상 응답 봉투.
    역할: 매 테스트에서 응답 뼈대를 반복하지 않게 한다.
    호출 예시: payload = _success_envelope([...])
    """
    return {
        "response": {
            "header": {"resultCode": "00", "resultMsg": "NORMAL_SERVICE"},
            "body": {"items": {"item": items}},
        }
    }


class GridConversionTest(unittest.TestCase):
    """
    입력: unittest 실행 컨텍스트.
    출력: 위경도 -> 격자 좌표 변환 검증 결과.
    역할: 공개적으로 알려진 기준점으로 LCC 변환 상수가 맞는지 확인한다.
    호출 예시: python -m unittest services.app-api.tests.test_weather_client
    """

    def test_seoul_city_hall_reference_point(self) -> None:
        self.assertEqual(latlng_to_grid(37.5665, 126.9780), (60, 127))

    def test_daejeon_city_hall_reference_point(self) -> None:
        self.assertEqual(latlng_to_grid(36.3504, 127.3845), (67, 100))

    def test_busan_city_hall_reference_point(self) -> None:
        self.assertEqual(latlng_to_grid(35.1798, 129.0750), (98, 76))


class BaseSlotSelectionTest(unittest.TestCase):
    """
    입력: unittest 실행 컨텍스트.
    출력: 발표 슬롯 선택 로직 검증 결과.
    역할: 자정 경계를 포함해 가장 최근의 "이미 발표됐다고 볼 수 있는" 슬롯을 고르는지 확인한다.
    호출 예시: python -m unittest services.app-api.tests.test_weather_client
    """

    def test_picks_most_recent_slot_past_safety_margin(self) -> None:
        # 15시 20분이면 안전 마진(15분) 지난 14시 슬롯을 써야 한다.
        now_kst = datetime(2026, 9, 22, 15, 20, tzinfo=KST)
        self.assertEqual(latest_valid_base_datetime(now_kst), ("20260922", "1400"))

    def test_does_not_pick_just_published_slot_within_safety_margin(self) -> None:
        # 14시 5분은 14시 슬롯이 아직 안전 마진 안이라 11시 슬롯을 써야 한다.
        now_kst = datetime(2026, 9, 22, 14, 5, tzinfo=KST)
        self.assertEqual(latest_valid_base_datetime(now_kst), ("20260922", "1100"))

    def test_rolls_back_to_previous_day_after_midnight(self) -> None:
        # 자정 직후(00시 30분)에는 아직 오늘 02시 슬롯이 없으니 어제 23시 슬롯을 써야 한다.
        now_kst = datetime(2026, 9, 23, 0, 30, tzinfo=KST)
        self.assertEqual(latest_valid_base_datetime(now_kst), ("20260922", "2300"))


class ConditionAndNoteTest(unittest.TestCase):
    """
    입력: unittest 실행 컨텍스트.
    출력: SKY/PTY 조건 문구와 외출 안내 문구 검증 결과.
    역할: 코드표 -> 한글 문구 변환이 예상대로 동작하는지 확인한다.
    호출 예시: python -m unittest services.app-api.tests.test_weather_client
    """

    def test_pty_overrides_sky_when_raining(self) -> None:
        self.assertEqual(sky_pty_to_condition("1", "1"), "비")

    def test_sky_used_when_no_precipitation(self) -> None:
        self.assertEqual(sky_pty_to_condition("3", "0"), "구름 많음")

    def test_outdoor_note_flags_high_rain_probability(self) -> None:
        self.assertIn("우산", build_outdoor_note(22.0, 70))

    def test_outdoor_note_defaults_when_nothing_notable(self) -> None:
        self.assertEqual(build_outdoor_note(20.0, 5), "야외 활동하기 좋은 날씨예요.")


class WeatherClientTest(unittest.TestCase):
    """
    입력: unittest 실행 컨텍스트.
    출력: WeatherClient 폴백·파싱 정책 검증 결과.
    역할: 실제 네트워크 없이 키 없음/서킷 오픈/범위 밖/성공/실패 흐름을 확인한다.
    호출 예시: python -m unittest services.app-api.tests.test_weather_client
    """

    def test_normalize_service_key_decodes_encoded_public_data_key(self) -> None:
        self.assertEqual(normalize_service_key("abc%2Bdef%2Fghi%3D"), "abc+def/ghi=")

    def test_returns_unavailable_when_service_key_missing(self) -> None:
        client = WeatherClient("")
        payload, status = client.fetch_forecast(36.3504, 127.3845, None)
        self.assertEqual(payload, {"unavailable": True})
        self.assertEqual(status, "fallback:not_configured")

    def test_returns_unavailable_when_date_outside_forecast_window(self) -> None:
        client = WeatherClient("fake-key")
        far_future_date = date.today() + timedelta(days=10)
        payload, status = client.fetch_forecast(36.3504, 127.3845, far_future_date)
        self.assertEqual(payload, {"unavailable": True})
        self.assertEqual(status, "fallback:out_of_range")

    def test_parses_successful_response_into_frontend_shape(self) -> None:
        client = WeatherClient("fake-key")
        today = datetime.now(KST).date()
        today_str = today.strftime("%Y%m%d")
        # 변수 의미: 지금 이후 슬롯이 확실히 하나는 있도록 자정 슬롯도 함께 넣는다.
        items = [
            _build_item(today_str, "2300", "TMP", "18.0"),
            _build_item(today_str, "2300", "POP", "30"),
            _build_item(today_str, "2300", "SKY", "3"),
            _build_item(today_str, "2300", "PTY", "0"),
        ]
        payload = _success_envelope(items)

        with patch("questbook_api.integrations.weather.client.urlopen", return_value=FakeWeatherResponse(payload)):
            result, status = client.fetch_forecast(36.3504, 127.3845, today)

        self.assertEqual(status, "live")
        self.assertFalse(result["unavailable"])
        self.assertEqual(result["temperatureC"], 18.0)
        self.assertEqual(result["precipitationProbability"], 30)
        self.assertEqual(result["condition"], "구름 많음")
        self.assertEqual(len(result["hourly"]), 1)
        self.assertEqual(result["hourly"][0]["time"], "23시")

    def test_caches_successful_response_without_calling_upstream_again(self) -> None:
        client = WeatherClient("fake-key")
        today = datetime.now(KST).date()
        today_str = today.strftime("%Y%m%d")
        items = [_build_item(today_str, "2300", "TMP", "18.0")]
        payload = _success_envelope(items)

        with patch(
            "questbook_api.integrations.weather.client.urlopen", return_value=FakeWeatherResponse(payload),
        ) as mocked_urlopen:
            client.fetch_forecast(36.3504, 127.3845, today)
            _second_result, second_status = client.fetch_forecast(36.3504, 127.3845, today)

        self.assertEqual(mocked_urlopen.call_count, 1)
        self.assertEqual(second_status, "live:cached")

    def test_falls_back_and_opens_circuit_after_repeated_upstream_errors(self) -> None:
        client = WeatherClient("fake-key")
        today = datetime.now(KST).date()

        with patch("questbook_api.integrations.weather.client.urlopen", side_effect=URLError("boom")):
            for _ in range(3):
                _payload, status = client.fetch_forecast(36.3504, 127.3845, today)
                self.assertEqual(status, "fallback:upstream_error")

        # 세 번 연속 실패했으니 이제는 업스트림을 부르지 않고 바로 서킷 오픈으로 폴백해야 한다.
        with patch("questbook_api.integrations.weather.client.urlopen") as mocked_urlopen:
            _payload, status = client.fetch_forecast(36.3504, 127.3845, today)
            mocked_urlopen.assert_not_called()
        self.assertEqual(status, "fallback:circuit_open")

    def test_status_reports_configured_and_daily_call_count(self) -> None:
        client = WeatherClient("fake-key")
        today = datetime.now(KST).date()
        items = [_build_item(today.strftime("%Y%m%d"), "2300", "TMP", "18.0")]
        payload = _success_envelope(items)

        with patch("questbook_api.integrations.weather.client.urlopen", return_value=FakeWeatherResponse(payload)):
            client.fetch_forecast(36.3504, 127.3845, today)

        status = client.status()
        self.assertTrue(status["configured"])
        self.assertEqual(status["dailyCallCount"], 1)
        self.assertEqual(status["failureCount"], 0)


if __name__ == "__main__":
    unittest.main()
