"""꿈돌이 테마와 퀘스트 누적 완료 기준. 이미지 형식·해상도는 같은 보상으로 취급한다."""
from __future__ import annotations

# DB 카테고리, 화면 카테고리, 이름, 이미지 접두사, 새 Lv 이미지 여부.
THEMES = (
    ("science", "science", "과학", "science", True),
    ("bread", "bread", "빵", "bread", True),
    ("food", "noodle", "음식", "food", True),
    ("nature", "nature", "자연", "nature", False),
    ("sport", "sport", "스포츠", "baseball", True),
    ("downtown", "heritage", "역사", "history", True),
    ("culture", "culture", "문화", "culture", False),
    ("market", "market", "시장·쇼핑", "shopping", True),
    ("mobility", "tashu", "타슈", "tashu", True),
    ("hotspring", "spa", "온천", "spa", True),
    ("festival", "festival", "축제", "festival", True),
)
THEME_CODES = {row[0] for row in THEMES}


def artwork(prefix: str, tier: int, new: bool) -> str:
    return f"/assets/ggumdori/{prefix}_lv{tier}_128.png" if new else f"/assets/ggumdori/{prefix}-{tier}.png"


GGUMDORI_SEEDS = [
    ("ggumdori_default_1", "기본 꿈돌이", "default", 1, "기본 지급",
     "/assets/ggumdori/기본_128.png", "대전 탐험을 시작하는 기본 꿈돌이입니다.", "common", 0),
    *[
        (f"ggumdori_{code}_{tier}", f"{label} 꿈돌이 Lv.{tier}", code, tier,
         f"{label} 퀘스트 누적 {tier}회 성공", artwork(prefix, tier, new),
         f"{label} 퀘스트를 {tier}회 완료하면 해금됩니다.",
         ("common", "rare", "epic")[tier - 1], order * 10 + tier)
        for order, (code, _, label, prefix, new) in enumerate(THEMES, 1)
        for tier in (1, 2, 3)
    ],
]
ACTIVE_VARIANT_IDS = [row[0] for row in GGUMDORI_SEEDS]


def completion_theme(category: str, place_name: str, title: str = "") -> str:
    """이전 6분류 퀘스트는 저장된 장소·제목으로 세분화한다. 한 완료는 한 테마에만 집계한다."""
    category = {
        "heritage": "downtown", "history": "downtown", "shopping": "market",
        "tashu": "mobility", "spa": "hotspring", "hot_spring": "hotspring",
        "noodle": "food", "baseball": "sport", "nightview": "culture",
    }.get(category, category)
    # 이미 세분화된 분류는 이름 추정보다 우선한다.
    if category in {"bread", "food", "sport", "festival", "hotspring", "culture", "mobility", "science"}:
        return category
    text = f"{place_name} {title}".lower()
    for theme, keywords in (
        ("festival", ("축제", "페스티벌", "festival")),
        ("hotspring", ("온천", "족욕", "스파")),
        ("sport", ("야구", "볼파크", "이글스", "스포츠", "경기장", "체육")),
        ("bread", ("성심당", "베이커리", "제빵", "빵", "브레드")),
        ("food", ("칼국수", "국수", "우동", "라멘", "냉면", "음식", "식당", "맛집", "한식", "중식")),
    ):
        if any(keyword in text for keyword in keywords):
            return theme
    return category if category in THEME_CODES else ""
