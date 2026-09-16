# 일일 카탈로그 실행의 완결성·중복 방지·한국 날짜와 안전한 종료를 검증한다.
from __future__ import annotations

from contextlib import contextmanager
from datetime import date, datetime, timezone
import importlib
from threading import Event
from types import SimpleNamespace
from typing import Any, Iterator
from unittest.mock import Mock, patch

import pytest

from questbook_api.domain.models import TourPlaceCandidate
from questbook_api.integrations.tourapi.client import TourApiClient


def sync_module() -> Any:
    """입력: 없음. 출력: 실행기 모듈. 역할: 구현 부재를 명시적으로 검증한다. 예시: module = sync_module()."""
    assert importlib.util.find_spec("questbook_api.catalog_sync") is not None
    return importlib.import_module("questbook_api.catalog_sync")


class MemoryCatalogRepository:
    """입력: 없음. 출력: 메모리 저장소. 역할: DB 없는 실행 상태 경계를 재현한다. 예시: repository = MemoryCatalogRepository()."""

    def __init__(self) -> None:
        """입력: 없음. 출력: 없음. 역할: 날짜별 상태와 변경 이력을 초기화한다. 예시: MemoryCatalogRepository()."""
        # 변수 의미: 동시 실행 방지 잠금의 사용 가능 상태다.
        self.available = True
        # 변수 의미: 현재 동기화가 잠금을 보유하는지 여부다.
        self.locked = False
        # 변수 의미: 같은 날짜 실행을 차단할 날짜별 최종 상태다.
        self.runs: dict[date, tuple[str, dict[str, Any]]] = {}
        # 변수 의미: 저장 함수가 받은 실제 완결 목록과 유예일이다.
        self.saved: list[tuple[Any, Any, Any, int]] = []
        # 변수 의미: 실제 psycopg 연결의 재사용 가능 상태를 재현한다.
        self._connection = SimpleNamespace(closed=False, broken=False)

    @contextmanager
    def catalog_sync_lock(self) -> Iterator[bool]:
        """입력: 없음. 출력: 잠금 성공 여부. 역할: 실행 중 잠금 소유를 확인한다. 예시: with repository.catalog_sync_lock()."""
        self.locked = self.available
        try:
            yield self.available
        finally:
            self.locked = False

    def claim_catalog_run(self, run_date: date, *, force: bool = False) -> bool:
        """입력: 날짜·강제 여부. 출력: 실행 허용 여부. 역할: 실패한 날짜도 중복을 차단한다. 예시: repository.claim_catalog_run(day)."""
        assert self.locked
        if run_date in self.runs and not force:
            return False
        self.runs[run_date] = ("running", {})
        return True

    def finish_catalog_run(self, run_date: date, status: str, stats: dict[str, Any]) -> None:
        """입력: 날짜·결과·집계. 출력: 없음. 역할: 안전한 결과를 지속 기록한다. 예시: repository.finish_catalog_run(day, "live", {})."""
        assert self.locked
        assert status in {"completed", "failed"}
        self.runs[run_date] = (status, stats)

    def sync_catalog(self, places: Any, quest_definitions: Any, *, observed_at: datetime, missing_grace_days: int) -> dict[str, int]:
        """입력: 장소·퀘스트·관측시각·유예. 출력: 집계. 역할: 저장 경계와 잠금 유지 여부를 검증한다. 예시: repository.sync_catalog(places, quests, ...)."""
        assert self.locked
        self.saved.append((places, quest_definitions, observed_at, missing_grace_days))
        return {"placesUpserted": len(places), "questsUpserted": len(quest_definitions)}


def candidate(content_id: str, category: str = "nature") -> TourPlaceCandidate:
    """입력: ID·카테고리. 출력: 장소. 역할: 재사용 퀘스트 생성 입력을 제공한다. 예시: candidate("1")."""
    return TourPlaceCandidate(content_id, "대전 공원", 36.3, 127.4, category, "자연 관찰", "관광지", None, "tourapi")


def test_sync_generates_reusable_definitions_only_after_complete_scan() -> None:
    """입력: 완결된 지원·미지원 장소. 출력: 저장 상태. 역할: 공용 퀘스트 생성과 유예 설정 전달을 검증한다. 예시: pytest -k reusable_definitions."""
    # 변수 의미: 실행기·테스트 저장소·UTC 관측 시각·원천 목록이다.
    module = sync_module()
    repository = MemoryCatalogRepository()
    now = datetime(2026, 9, 7, 16, tzinfo=timezone.utc)
    places = [candidate("1"), candidate("2", "unsupported")]
    with patch.object(module, "fetch_catalog", return_value=(places, "live")):
        # 변수 의미: 한국 날짜로 수행된 전체 동기화 결과다.
        result = module.run_catalog_sync(repository, TourApiClient("test-key"), now=now, missing_grace_days=9)
    assert result["status"] == "live"
    assert result["runDate"] == "2026-09-08"
    assert len(repository.saved) == 1
    assert repository.saved[0][0] == places
    assert repository.saved[0][2:] == (now, 9)
    # 변수 의미: 기존 생성 규칙이 만든 저장 가능한 공용 퀘스트다.
    definitions = repository.saved[0][1]
    assert len(definitions) == 1
    assert definitions[0]["placeContentId"] == "1"
    assert definitions[0]["createdForUserId"] is None
    assert repository.runs[date(2026, 9, 8)][0] == "completed"
    assert not repository.locked


@pytest.mark.parametrize("source_status", ["live:partial", "incomplete:row_count", "error:upstream_error", "fallback:not_configured"])
def test_partial_or_failed_scan_never_mutates_catalog(source_status: str) -> None:
    """입력: 일부 장소와 실패 상태. 출력: 기존 목록 보존. 역할: live 완결만 저장하는 경계를 검증한다. 예시: pytest -k never_mutates."""
    # 변수 의미: 실행기·저장소·관측 시각이다.
    module = sync_module()
    repository = MemoryCatalogRepository()
    now = datetime(2026, 9, 8, tzinfo=timezone.utc)
    with patch.object(module, "fetch_catalog", return_value=([candidate("1")], source_status)):
        # 변수 의미: 미완결 결과와 동일 날짜 재실행 결과다.
        result = module.run_catalog_sync(repository, TourApiClient("test-key"), now=now)
        second_result = module.run_catalog_sync(repository, TourApiClient("test-key"), now=now)
    assert result["status"] != "live"
    assert second_result["status"] == "skipped:already_attempted"
    assert repository.saved == []
    assert repository.runs[date(2026, 9, 8)][0] == "failed"


def test_valid_empty_sync_is_applied_once_each_korea_day_with_explicit_force() -> None:
    """입력: 빈 완결 결과·날짜 변경·강제 요청. 출력: 허용된 3회 저장. 역할: 한국 날짜와 수동 재실행 규칙을 검증한다. 예시: pytest -k explicit_force."""
    # 변수 의미: 실행기와 날짜별 실행 이력을 보존할 저장소다.
    module = sync_module()
    repository = MemoryCatalogRepository()
    with patch.object(module, "fetch_catalog", return_value=([], "live")):
        assert module.run_catalog_sync(repository, TourApiClient("test-key"), now=datetime(2026, 9, 8, 14, 59, tzinfo=timezone.utc))["status"] == "live"
        assert module.run_catalog_sync(repository, TourApiClient("test-key"), now=datetime(2026, 9, 8, 14, 59, tzinfo=timezone.utc))["status"] == "skipped:already_attempted"
        assert module.run_catalog_sync(repository, TourApiClient("test-key"), now=datetime(2026, 9, 8, 15, tzinfo=timezone.utc))["status"] == "live"
        assert module.run_catalog_sync(repository, TourApiClient("test-key"), now=datetime(2026, 9, 8, 15, tzinfo=timezone.utc), force=True)["status"] == "live"
    assert len(repository.saved) == 3
    assert repository.saved[0][0:2] == ([], [])


def test_lock_contention_skips_without_claiming_day_or_mutating() -> None:
    """입력: 다른 작업의 잠금. 출력: 건너뛰기. 역할: 중복 수집·동기화를 차단한다. 예시: pytest -k lock_contention."""
    # 변수 의미: 동시 실행을 재현할 모듈과 저장소다.
    module = sync_module()
    repository = MemoryCatalogRepository()
    repository.available = False
    # 변수 의미: 잠금 획득 실패로 건너뛴 실행 결과다.
    result = module.run_catalog_sync(repository, TourApiClient("test-key"))
    assert result["status"] == "skipped:locked"
    assert repository.runs == {}
    assert repository.saved == []


def test_unexpected_errors_are_sanitized_and_the_failed_day_is_recorded() -> None:
    """입력: 인증값을 포함한 예외. 출력: 안전한 실패 상태. 역할: 재시도 폭주와 로그 노출을 방지한다. 예시: pytest -k unexpected_errors."""
    # 변수 의미: 실행기·저장소·관측 시각이다.
    module = sync_module()
    repository = MemoryCatalogRepository()
    now = datetime(2026, 9, 8, tzinfo=timezone.utc)
    with patch.object(module, "fetch_catalog", side_effect=RuntimeError("https://private/?key=sensitive-marker")):
        # 변수 의미: 원문 예외를 제거한 실패 결과다.
        result = module.run_catalog_sync(repository, TourApiClient("test-key"), now=now)
    assert result["status"] == "error:sync_failed"
    assert "sensitive-marker" not in str(result)
    assert "https" not in str(repository.runs)
    assert repository.runs[date(2026, 9, 8)][0] == "failed"
    assert repository.runs[date(2026, 9, 8)][1]["source_status"] == "error:sync_failed"
    assert repository.saved == []


def test_daily_scheduler_checks_day_changes_and_stops_without_long_waits() -> None:
    """입력: 한국 자정 전후 시계와 종료 이벤트. 출력: 날짜별 실행. 역할: 서버와 독립적인 일일 스케줄을 검증한다. 예시: pytest -k daily_scheduler."""
    # 변수 의미: 실행 모듈·저장소·종료 이벤트와 날짜 경계를 지나는 시각이다.
    module = sync_module()
    repository = MemoryCatalogRepository()
    stop_event = Event()
    moments = iter([
        datetime(2026, 9, 8, 14, 59, tzinfo=timezone.utc),
        datetime(2026, 9, 8, 14, 59, 30, tzinfo=timezone.utc),
        datetime(2026, 9, 8, 15, tzinfo=timezone.utc),
    ])
    # 변수 의미: 스케줄러가 요청한 대기 횟수다.
    waits: list[float] = []

    def wait_then_stop(seconds: float) -> bool:
        """입력: 대기 시간. 출력: 종료 여부. 역할: 실제 대기 없이 3회 점검 후 종료한다. 예시: wait_then_stop(60)."""
        assert 0 < seconds <= 60
        waits.append(seconds)
        if len(waits) == 3:
            stop_event.set()
        return stop_event.is_set()

    with patch.object(module, "fetch_catalog", return_value=([], "live")), patch.object(stop_event, "wait", side_effect=wait_then_stop):
        module.run_daily(repository, TourApiClient("test-key"), stop_event=stop_event, clock=lambda: next(moments))
    assert len(repository.saved) == 2
    assert set(repository.runs) == {date(2026, 9, 8), date(2026, 9, 9)}


def test_daily_force_is_rejected_before_reading_runtime_configuration() -> None:
    """입력: 일일 모드 강제 옵션. 출력: 인자 오류. 역할: 자동 재시도 제한 우회를 막는다. 예시: pytest -k daily_force."""
    # 변수 의미: CLI 인자를 검사할 실행기 모듈이다.
    module = sync_module()
    with pytest.raises(SystemExit) as error:
        module.main(["--daily", "--force"])
    assert error.value.code == 2


@pytest.mark.parametrize("grace_days", ["0", "-1", "not-an-integer"])
def test_cli_rejects_invalid_grace_without_opening_database(grace_days: str, monkeypatch: pytest.MonkeyPatch, capsys: Any) -> None:
    """입력: 잘못된 유예 설정. 출력: 안전한 오류. 역할: 잘못된 환경 변수의 조기 적용을 막는다. 예시: pytest -k invalid_grace."""
    # 변수 의미: CLI 실행 모듈이다.
    module = sync_module()
    monkeypatch.setenv("QUESTBOOK_CATALOG_MISSING_GRACE_DAYS", grace_days)
    monkeypatch.delenv("QUESTBOOK_DATABASE_URL", raising=False)
    assert module.main(["--once"]) == 2
    assert "error:invalid_grace_days" in capsys.readouterr().out


def test_cli_reports_missing_database_without_exposing_runtime_values(monkeypatch: pytest.MonkeyPatch, capsys: Any) -> None:
    """입력: 미설정 DB와 비밀값. 출력: DB 설정 오류. 역할: 로컬 우발 연결과 인증값 노출을 막는다. 예시: pytest -k missing_database."""
    # 변수 의미: 환경값 검증 대상 실행기다.
    module = sync_module()
    monkeypatch.setenv("QUESTBOOK_CATALOG_MISSING_GRACE_DAYS", "7")
    monkeypatch.delenv("QUESTBOOK_DATABASE_URL", raising=False)
    monkeypatch.setenv("TOURAPI_SERVICE_KEY", "sensitive-marker")
    assert module.main(["--once"]) == 2
    # 변수 의미: 인증값 없는 단발 실행의 표준 출력이다.
    output = capsys.readouterr().out
    assert "error:database_not_configured" in output
    assert "sensitive-marker" not in output


def test_cancelled_sync_records_failure_without_catalog_changes() -> None:
    """입력: 완료 직후 종료 이벤트. 출력: 취소 기록. 역할: 종료 요청 이후 새 쓰기를 방지한다. 예시: pytest -k cancelled_sync."""
    # 변수 의미: 실행기·저장소·이미 설정된 종료 이벤트다.
    module = sync_module()
    repository = MemoryCatalogRepository()
    stop_event = Event()
    stop_event.set()
    with patch.object(module, "fetch_catalog", return_value=([candidate("1")], "live")):
        # 변수 의미: 종료 요청으로 취소된 결과다.
        result = module.run_catalog_sync(repository, TourApiClient("test-key"), stop_event=stop_event)
    assert result["status"] == "cancelled"
    assert repository.saved == []
    assert next(iter(repository.runs.values()))[0] == "failed"


def test_untrusted_source_status_is_not_logged_or_persisted() -> None:
    """입력: 인증값 형태를 포함한 원천 상태. 출력: 고정 실패 상태. 역할: 상태 문자열도 로그 신뢰 경계를 통과하지 않게 한다. 예시: pytest -k untrusted_source."""
    # 변수 의미: 실행기와 상태를 보관할 저장소다.
    module = sync_module()
    repository = MemoryCatalogRepository()
    with patch.object(module, "fetch_catalog", return_value=([], "error:https://private/?key=sensitive-marker")):
        # 변수 의미: 외부 문자열을 제거한 안전한 실행 결과다.
        result = module.run_catalog_sync(repository, TourApiClient("test-key"))
    assert result["status"] == "error:incomplete_scan"
    assert "sensitive-marker" not in str(repository.runs)
    assert "sensitive-marker" not in str(result)


@pytest.mark.parametrize("failed_operation", ["initialize", "close"])
def test_cli_database_lifecycle_errors_never_escape_as_secret_tracebacks(failed_operation: str, monkeypatch: pytest.MonkeyPatch, capsys: Any) -> None:
    """입력: DB 초기화·종료 예외. 출력: 안전한 상태와 종료 코드. 역할: 실행기 종료 경로의 인증값 노출을 방지한다. 예시: pytest -k lifecycle_errors."""
    # 변수 의미: 실행기 모듈과 외부 연결을 대신하는 생명주기 경계다.
    module = sync_module()
    repository = Mock()
    getattr(repository, failed_operation).side_effect = RuntimeError("sensitive-marker")
    monkeypatch.setenv("QUESTBOOK_DATABASE_URL", "postgresql://test-only-placeholder")
    monkeypatch.setenv("QUESTBOOK_CATALOG_MISSING_GRACE_DAYS", "7")
    with patch.object(module, "QuestbookRepository", return_value=repository), patch.object(module.signal, "signal"), patch.object(module, "run_catalog_sync", return_value={"status": "live", "stats": {}}):
        assert module.main(["--once"]) == 1
    assert "sensitive-marker" not in capsys.readouterr().out


@pytest.mark.parametrize("connection_state", ["closed", "broken"])
@pytest.mark.parametrize("failed_operation", ["claim_catalog_run", "sync_catalog", "finish_catalog_run"])
def test_unusable_connection_escapes_daily_loop_as_sanitized_failure(
    connection_state: str, failed_operation: str,
) -> None:
    """
    입력: 실행 기록·카탈로그 저장·완료 기록 중 끊어진 DB 연결.
    출력: 재사용할 수 없는 연결을 알리는 안전한 예외.
    역할: 일일 실행기가 손상된 연결을 영구 보유하지 않도록 한다.
    호출 예시: pytest -k unusable_connection
    """
    # 변수 의미: 실제 실행 로직과 연결 상태를 재현할 저장소다.
    module = sync_module()
    repository = MemoryCatalogRepository()

    def disconnect(*_args: Any, **_kwargs: Any) -> None:
        """
        입력: 실패할 저장소 연산의 인자.
        출력: 없음. DB 연결 예외를 발생시킨다.
        역할: 실제 DB 재시작 없이 libpq의 연결 손상 상태를 재현한다.
        호출 예시: disconnect(run_date)
        """
        setattr(repository._connection, connection_state, True)
        raise RuntimeError("postgresql://private/?key=sensitive-marker")

    with (
        patch.object(module, "fetch_catalog", return_value=([], "live")),
        patch.object(repository, failed_operation, side_effect=disconnect),
        pytest.raises(RuntimeError, match="Catalog database connection unavailable") as error,
    ):
        module.run_catalog_sync(repository, TourApiClient("test-key"))
    assert "sensitive-marker" not in str(error.value)
    assert error.value.__suppress_context__
    assert not repository.locked


def test_daily_cli_exits_after_database_disconnect_for_process_restart(
    monkeypatch: pytest.MonkeyPatch, capsys: Any,
) -> None:
    """
    입력: 첫 DB 연산에서 연결이 끊기는 일일 CLI.
    출력: 안전한 실패 JSON과 종료 코드 1.
    역할: Compose가 종료된 프로세스를 새 DB 연결로 재시작할 수 있게 한다.
    호출 예시: pytest -k daily_cli_exits
    """
    # 변수 의미: 실행기·저장소와 실제 대기 없이 반복 여부를 검증할 종료 이벤트다.
    module = sync_module()
    repository = MemoryCatalogRepository()
    stop_event = Event()

    def disconnect(*_args: Any, **_kwargs: Any) -> None:
        """입력: 실행 선점 인자. 출력: DB 예외. 역할: 첫 연산의 연결 손상을 재현한다. 호출 예시: disconnect(day)."""
        repository._connection.broken = True
        raise RuntimeError("sensitive-marker")

    def stop_if_loop_continues(_seconds: float) -> bool:
        """입력: 대기 시간. 출력: 종료 요청. 역할: 결함 재현 시에도 테스트가 대기하지 않게 한다. 호출 예시: stop_if_loop_continues(60)."""
        stop_event.set()
        return True

    monkeypatch.setenv("QUESTBOOK_DATABASE_URL", "postgresql://test-only-placeholder")
    monkeypatch.setenv("QUESTBOOK_CATALOG_MISSING_GRACE_DAYS", "7")
    with (
        patch.object(module, "QuestbookRepository", return_value=repository),
        patch.object(repository, "initialize", create=True),
        patch.object(repository, "close", create=True),
        patch.object(repository, "claim_catalog_run", side_effect=disconnect),
        patch.object(module.signal, "signal"),
        patch.object(module, "Event", return_value=stop_event),
        patch.object(stop_event, "wait", side_effect=stop_if_loop_continues),
    ):
        assert module.main(["--daily"]) == 1
    # 변수 의미: 안전한 연결 오류만 포함해야 하는 CLI 표준 출력이다.
    output = capsys.readouterr().out
    assert "error:database_unavailable" in output
    assert "sensitive-marker" not in output
    assert not stop_event.is_set()
