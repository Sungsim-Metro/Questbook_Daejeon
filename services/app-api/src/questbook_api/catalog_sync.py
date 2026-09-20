# 한국 날짜 기준으로 하루 한 번 공용 관광지·퀘스트 카탈로그를 갱신하는 독립 실행기다.
from __future__ import annotations

import argparse
from collections.abc import Callable, Sequence
from datetime import date, datetime, timedelta, timezone
import json
import os
import signal
from threading import Event
from typing import Any

from questbook_api.application.quest_generation import build_catalog_quest
from questbook_api.infrastructure.repository import QuestbookRepository
from questbook_api.integrations.tourapi.catalog import fetch_catalog
from questbook_api.integrations.tourapi.client import TourApiClient
from questbook_api.integrations.translation.client import TranslationClient
from questbook_api.settings import AppSettings


# 변수 의미: 외부 타임존 데이터 설치 없이 한국 날짜를 계산하는 UTC+9 시간대다.
KOREA_TIMEZONE = timezone(timedelta(hours=9))
# 변수 의미: 원천 응답이나 예외 원문 대신 기록할 수 있는 고정된 상태값이다.
SAFE_SOURCE_STATUSES = frozenset({
    "live", "cancelled", "error:not_configured", "error:invalid_page_limit",
    "error:upstream_result", "error:upstream_error", "incomplete:changed_total",
    "incomplete:wrong_page", "incomplete:row_count", "incomplete:invalid_item",
    "incomplete:duplicate_id", "incomplete:page_limit",
})


class CatalogDatabaseUnavailable(RuntimeError):
    """
    입력: 인증값을 포함하지 않는 고정 오류 설명.
    출력: 일일 프로세스 종료가 필요한 DB 연결 오류.
    역할: 재사용 불가능한 연결을 일반적인 일일 실행 실패와 구별한다.
    호출 예시: raise CatalogDatabaseUnavailable("Catalog database connection unavailable")
    """


def _raise_if_database_unavailable(repository: QuestbookRepository) -> None:
    """
    입력: 카탈로그 작업 전용 저장소.
    출력: 없음. 연결이 닫히거나 손상된 경우 안전한 예외를 발생시킨다.
    역할: 죽은 연결을 보유한 일일 루프를 종료해 프로세스 재시작으로 복구한다.
    호출 예시: _raise_if_database_unavailable(repository)
    """
    if repository._connection.closed or repository._connection.broken:
        raise CatalogDatabaseUnavailable(
            "Catalog database connection unavailable",
        ) from None


def sync_place_name_translations(
    repository: QuestbookRepository,
    client: TourApiClient,
    translation_client: TranslationClient | None,
    places: list,
) -> None:
    """
    입력: 저장소, TourAPI 클라이언트, 번역 클라이언트(없을 수 있음), 이번 관측의 전체 장소.
    출력: 없음. place_name_translations 캐시를 갱신한다.
    역할: 퀘스트 제목/설명은 영문 템플릿 + 장소명 조합으로 요청 시점에 재조립하므로(
          quest_generation.build_localized_quest_text), 매일 배치에서 장소명만 1회 영문화해
          캐싱해 두면 매 사용자 요청마다 재번역할 필요가 없다. TourAPI EngService2에 이미
          영문명이 있으면 그걸 우선 쓰고(무료, 호출량 제한 없음), 없을 때만 Google Translate를
          아주 조금만 호출한다(무료 할당량을 아끼기 위함).
    호출 예시: sync_place_name_translations(repository, client, translation_client, places)
    """
    # 변수 의미: 국문명이 바뀌지 않은 이미 번역된 장소는 다시 번역하지 않기 위한 기존 캐시다.
    existing = repository.get_place_name_translations([place.content_id for place in places])
    # 변수 의미: 새로 번역해야 하는 장소(신규 또는 국문명이 바뀐 장소)다.
    stale_places = [
        place for place in places
        if existing.get(place.content_id, {}).get("nameKor") != place.title
    ]
    # 변수 의미: 이번에 새로 확정한 (contentId, 국문명, 영문명, 출처) 행이다.
    translated_rows: list[tuple[str, str, str, str]] = []
    for place in stale_places:
        english_name = None
        try:
            english_name = client.find_english_place_name(place.title, place.latitude, place.longitude)
        except Exception:
            english_name = None
        if english_name:
            translated_rows.append((place.content_id, place.title, english_name, "tourapi"))
            continue
        if translation_client is None or not translation_client.is_configured():
            continue
        machine_translated = translation_client.translate_text(place.title, "eng")
        if machine_translated:
            translated_rows.append((place.content_id, place.title, machine_translated, "machine"))
    if translated_rows:
        repository.upsert_place_name_translations(translated_rows)


def run_catalog_sync(
    repository: QuestbookRepository,
    client: TourApiClient,
    *,
    now: datetime | None = None,
    missing_grace_days: int = 7,
    force: bool = False,
    stop_event: Event | None = None,
    translation_client: TranslationClient | None = None,
) -> dict[str, Any]:
    """
    입력: 별도 연결의 저장소와 클라이언트, 관측 시각·누락 유예일·수동 강제·종료 이벤트.
    출력: 한국 실행 날짜와 안전한 상태·집계. 손상된 DB 연결이면 안전한 예외.
    역할: 잠금과 영구 실행 기록을 확보한 뒤 완결된 원천만 원자적으로 동기화한다.
    호출 예시: result = run_catalog_sync(repository, client, missing_grace_days=7)
    """
    # 변수 의미: 이번 수집의 기준 UTC 시각이다.
    observed_at = now or datetime.now(timezone.utc)
    if observed_at.tzinfo is None:
        observed_at = observed_at.replace(tzinfo=timezone.utc)
    # 변수 의미: 사용자와 운영자가 이해하는 한국 기준 실행 날짜다.
    run_date = observed_at.astimezone(KOREA_TIMEZONE).date()
    # 변수 의미: 저장 가능한 고정 상태와 집계만 포함하는 실행 결과다.
    result: dict[str, Any] = {
        "runDate": run_date.isoformat(), "status": "error:sync_failed", "stats": {},
    }
    if (
        isinstance(missing_grace_days, bool)
        or not isinstance(missing_grace_days, int)
        or missing_grace_days < 1
    ):
        result["status"] = "error:invalid_grace_days"
        return result
    try:
        with repository.catalog_sync_lock() as acquired:
            if not acquired:
                result["status"] = "skipped:locked"
                return result
            if not repository.claim_catalog_run(run_date, force=force):
                result["status"] = "skipped:already_attempted"
                return result
            try:
                # 변수 의미: 완결성 검사를 통과한 전체 장소와 원천 상태다.
                places, source_status = fetch_catalog(client, stop_event=stop_event)
                result["status"] = (
                    source_status if source_status in SAFE_SOURCE_STATUSES
                    else "error:incomplete_scan"
                )
                if stop_event is not None and stop_event.is_set():
                    result["status"] = "cancelled"
                if result["status"] == "live":
                    # 변수 의미: 국문명이 바뀌었거나 신규인 장소만 영문명을 새로 확보해 캐싱한다.
                    sync_place_name_translations(repository, client, translation_client, places)
                    # 변수 의미: 사용자를 지정하지 않는 공용 재사용 퀘스트 정의 목록이다.
                    quest_definitions: list[dict[str, Any]] = []
                    # 변수 의미: 지원되는 테마인지 확인하며 생성할 현재 관광지다.
                    for place in places:
                        # 변수 의미: 지원되지 않는 카테고리이면 None인 공용 퀘스트다.
                        definition = build_catalog_quest(place)
                        if definition is not None:
                            quest_definitions.append(definition)
                    result["stats"] = repository.sync_catalog(
                        places, quest_definitions, observed_at=observed_at,
                        missing_grace_days=missing_grace_days,
                    )
            except Exception:
                _raise_if_database_unavailable(repository)
                # DB와 외부 예외에는 인증 정보가 들어갈 수 있으므로 원문을 출력하지 않는다.
                result["status"] = "error:sync_failed"
                result["stats"] = {}
            repository.finish_catalog_run(
                run_date, "completed" if result["status"] == "live" else "failed",
                {**result["stats"], "source_status": result["status"]},
            )
    except Exception:
        _raise_if_database_unavailable(repository)
        result["status"] = "error:sync_failed"
        result["stats"] = {}
    return result


def run_daily(
    repository: QuestbookRepository,
    client: TourApiClient,
    *,
    missing_grace_days: int = 7,
    stop_event: Event | None = None,
    clock: Callable[[], datetime] | None = None,
    translation_client: TranslationClient | None = None,
) -> None:
    """
    입력: 독립 저장소·클라이언트·유예일과 종료 이벤트, 선택적 시계, 선택적 번역 클라이언트.
    출력: 없음. 날짜별 실행 결과는 한 줄 JSON으로 기록한다.
    역할: 시작 시 오늘 실행을 확인하고 한국 날짜가 바뀔 때만 다시 확인한다.
    호출 예시: run_daily(repository, client, stop_event=shutdown_event)
    """
    # 변수 의미: SIGTERM 또는 호출자가 전달하는 정상 종료 요청이다.
    shutdown_event = stop_event if stop_event is not None else Event()
    # 변수 의미: 이 프로세스가 마지막으로 영구 실행 여부를 확인한 날짜다.
    checked_date: date | None = None
    while not shutdown_event.is_set():
        # 변수 의미: 실행 여부와 관측 시각에 공통으로 사용하는 현재 시각이다.
        current_time = clock() if clock is not None else datetime.now(timezone.utc)
        if current_time.tzinfo is None:
            current_time = current_time.replace(tzinfo=timezone.utc)
        # 변수 의미: 현재 한국 날짜다.
        current_date = current_time.astimezone(KOREA_TIMEZONE).date()
        if current_date != checked_date:
            # 변수 의미: 전체 동기화 또는 영구 중복 방지에 따른 결과다.
            result = run_catalog_sync(
                repository, client, now=current_time,
                missing_grace_days=missing_grace_days, stop_event=shutdown_event,
                translation_client=translation_client,
            )
            print(json.dumps(result, ensure_ascii=False, sort_keys=True), flush=True)
            checked_date = current_date
        shutdown_event.wait(60)


def main(argv: Sequence[str] | None = None) -> int:
    """
    입력: 선택적 CLI 인자 목록과 프로세스 환경 변수.
    출력: 성공·정상 종료 0, 실행 실패 1, 잘못된 설정 2.
    역할: 웹 서버와 별도 연결을 열어 단발 또는 일일 카탈로그 작업을 실행한다.
    호출 예시: python -m questbook_api.catalog_sync --once --force
    """
    # 변수 의미: 단발·일일 실행을 명시적으로 선택하는 CLI 파서다.
    parser = argparse.ArgumentParser(description="대전 관광지와 공용 퀘스트 카탈로그 동기화")
    # 변수 의미: 동시에 선택할 수 없는 실행 모드 그룹이다.
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--once", action="store_true", help="오늘 동기화를 한 번 시도하고 종료")
    mode.add_argument("--daily", action="store_true", help="한국 날짜 기준으로 매일 실행")
    parser.add_argument("--force", action="store_true", help="--once에서 오늘 실행 기록을 무시")
    # 변수 의미: 검증한 사용자 실행 인자다.
    arguments = parser.parse_args(argv)
    if arguments.force and not arguments.once:
        parser.error("--force는 --once와 함께 사용해야 합니다")
    try:
        # 변수 의미: 완결 조회에서 사라진 장소를 비활성화하기 전 유예하는 일수다.
        missing_grace_days = int(os.getenv("QUESTBOOK_CATALOG_MISSING_GRACE_DAYS", "7"))
        if missing_grace_days < 1:
            raise ValueError("Invalid grace period")
    except ValueError:
        print(json.dumps({"status": "error:invalid_grace_days"}), flush=True)
        return 2
    # 변수 의미: 컨테이너 또는 실행 환경에서만 읽고 출력하지 않는 DB 접속 값이다.
    database_url = os.getenv("QUESTBOOK_DATABASE_URL", "").strip()
    if not database_url:
        print(json.dumps({"status": "error:database_not_configured"}), flush=True)
        return 2
    # 변수 의미: SIGTERM과 SIGINT에서 설정하는 종료 이벤트다.
    shutdown_event = Event()
    # 변수 의미: 웹 API와 연결 및 외부 호출 상태를 공유하지 않는 저장소다.
    repository: QuestbookRepository | None = None
    # 변수 의미: 초기화와 자원 정리까지 끝난 뒤 반환할 종료 코드다.
    exit_code = 1

    def stop(_signal_number: int, _frame: Any) -> None:
        """
        입력: 운영체제 신호와 현재 프레임.
        출력: 없음.
        역할: 대기를 즉시 깨우고 진행 중 조회는 현재 페이지 후 취소한다.
        호출 예시: signal.signal(signal.SIGTERM, stop)
        """
        shutdown_event.set()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        repository = QuestbookRepository(database_url)
        repository.initialize()
        # 변수 의미: 환경에 주입된 키를 가진 백그라운드 전용 TourAPI 클라이언트다.
        client = TourApiClient(os.getenv("TOURAPI_SERVICE_KEY", ""))
        # 변수 의미: 장소명 영문화 배치가 쓸 번역 클라이언트다. 키가 없어도 TourAPI 영문
        # 매칭만으로 일부는 채워지므로, 미설정이어도 배치 자체는 계속 진행한다.
        translation_client = TranslationClient(AppSettings.from_env())
        if arguments.daily:
            run_daily(
                repository, client, missing_grace_days=missing_grace_days,
                stop_event=shutdown_event, translation_client=translation_client,
            )
            exit_code = 0
        else:
            # 변수 의미: 수동 단발 실행의 안전한 상태와 집계다.
            result = run_catalog_sync(
                repository, client, missing_grace_days=missing_grace_days,
                force=arguments.force, stop_event=shutdown_event,
                translation_client=translation_client,
            )
            print(json.dumps(result, ensure_ascii=False, sort_keys=True), flush=True)
            exit_code = 0 if result["status"] in {
                "live", "cancelled", "skipped:locked", "skipped:already_attempted",
            } else 1
    except CatalogDatabaseUnavailable:
        print(json.dumps({"status": "error:database_unavailable"}), flush=True)
    except Exception:
        print(json.dumps({"status": "error:initialization_failed"}), flush=True)
    finally:
        if repository is not None:
            try:
                repository.close()
            except Exception:
                print(json.dumps({"status": "error:cleanup_failed"}), flush=True)
                exit_code = 1
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
