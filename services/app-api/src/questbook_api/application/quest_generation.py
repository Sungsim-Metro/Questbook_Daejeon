# 일일 카탈로그와 기존 예시 추천에서 공유하는 순수 템플릿 퀘스트 생성을 담당한다.
from __future__ import annotations

from typing import Any

from questbook_api.domain.models import QuestTemplate, TourPlaceCandidate


# 변수 의미: baseline 카테고리별 템플릿 기반 퀘스트 생성 정책이다.
QUEST_TEMPLATES: dict[str, QuestTemplate] = {
    "nature": QuestTemplate("nature", "방문형", "gps", 50, "{place_name} 자연 관찰 체크인", "{place_name} 주변에서 오늘의 자연 단서를 기록하고 초록 탐험가 XP를 획득합니다."),
    "science": QuestTemplate("science", "테마형", "checklist", 80, "{place_name} 과학 탐험", "{place_name}에서 전시 키워드 하나를 수첩에 남기고 과학 탐험가 XP를 획득합니다."),
    "downtown": QuestTemplate("downtown", "이동형", "gps_distance", 40, "{place_name} 원도심 걷기", "{place_name} 주변을 걸으며 원도심 산책 기록을 완성합니다."),
    "market": QuestTemplate("market", "소비형", "receipt_or_sign_photo", 60, "{place_name} 로컬 상권 방문", "{place_name} 방문 사진 또는 영수증 인증으로 지역 상권 XP를 획득합니다."),
    "mobility": QuestTemplate("mobility", "이동형", "gps_distance", 70, "{place_name} 이동 루트", "{place_name}을 출발점으로 가까운 관광지를 연결하는 이동형 퀘스트입니다."),
    "nightview": QuestTemplate("nightview", "활동형", "time_window_photo", 70, "{place_name} 야경 기록", "{place_name}에서 저녁 시간대 전망 기록을 남깁니다."),
}

def build_template_quest(
    place: TourPlaceCandidate,
    template: QuestTemplate,
    created_for_user_id: str | None = None,
) -> dict[str, Any]:
    """
    입력: 장소, 적용할 템플릿, 선택적 최초 생성 사용자 ID.
    출력: 공용 퀘스트 저장용 데이터.
    역할: 장소명과 카테고리를 기존 템플릿 정책에 삽입한다.
    호출 예시: quest = build_template_quest(place, QUEST_TEMPLATES["nature"])
    """
    return {
        "title": template.title_template.format(place_name=place.title),
        "description": template.description_template.format(place_name=place.title),
        "type": template.quest_type,
        "categoryCode": template.category_code,
        "rewardXp": template.reward_xp,
        "verificationType": template.verification_type,
        "placeContentId": place.content_id,
        "placeName": place.title,
        "source": "template",
        "createdForUserId": created_for_user_id,
    }


def build_catalog_quest(place: TourPlaceCandidate) -> dict[str, Any] | None:
    """
    입력: 일일 수집으로 확보한 관광지 후보.
    출력: 사용자 귀속이 없는 저장 퀘스트 데이터 또는 미지원 카테고리의 None.
    역할: 지원 테마의 장소만 일일 공용 퀘스트 생성 대상으로 변환한다.
    호출 예시: quest = build_catalog_quest(place)
    """
    # 변수 의미: 관광지 카테고리에 정의된 생성 정책이다.
    template = QUEST_TEMPLATES.get(place.category_code)
    return build_template_quest(place, template) if template is not None else None
