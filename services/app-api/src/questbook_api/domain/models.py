# Questbook baseline 도메인에서 공유하는 데이터 구조를 정의한다.
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any


@dataclass(frozen=True)
class TourPlaceCandidate:
    """
    입력: TourAPI 또는 fallback에서 추출한 관광지 후보 필드.
    출력: 추천 계산과 화면 표시용 장소 후보 객체.
    역할: 원본 OpenAPI 응답 전체가 아니라 필요한 최소 필드만 앱 내부로 전달한다.
    호출 예시: place = TourPlaceCandidate(content_id="mock-1", title="한밭수목원", ...)
    """

    # 변수 의미: TourAPI contentId 또는 fallback 식별자다.
    content_id: str
    # 변수 의미: 화면에 표시할 관광지 이름이다.
    title: str
    # 변수 의미: 위도 좌표다.
    latitude: float
    # 변수 의미: 경도 좌표다.
    longitude: float
    # 변수 의미: Questbook 내부 카테고리 코드다.
    category_code: str
    # 변수 의미: 화면 표시용 카테고리 이름이다.
    category_name: str
    # 변수 의미: 추천 카드에 사용할 짧은 설명이다.
    summary: str
    # 변수 의미: 거리 미터 값이며 없으면 None이다.
    distance_meters: float | None
    # 변수 의미: 데이터 출처 표시용 값이다.
    source: str

    def to_public_dict(self) -> dict[str, Any]:
        """
        입력: 없음.
        출력: API 응답에 넣을 공개 가능한 딕셔너리.
        역할: secret 또는 원본 JSON 없이 화면에 필요한 장소 정보만 반환한다.
        호출 예시: payload = place.to_public_dict()
        """
        return {
            "contentId": self.content_id,
            "title": self.title,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "categoryCode": self.category_code,
            "categoryName": self.category_name,
            "summary": self.summary,
            "distanceMeters": self.distance_meters,
            "source": self.source,
        }


@dataclass(frozen=True)
class CacheEntry:
    """
    입력: 캐시 키에 연결된 장소 후보와 만료 시각.
    출력: 유저 단위 TourAPI 임시 캐시 객체.
    역할: 30분 동안 추천과 퀘스트 생성에 필요한 최소 필드만 보관한다.
    호출 예시: entry = CacheEntry(places=places, fetched_at=now, expires_at=expires)
    """

    # 변수 의미: 추천 계산에 사용할 관광지 후보 목록이다.
    places: list[TourPlaceCandidate]
    # 변수 의미: TourAPI 또는 fallback 조회 시각이다.
    fetched_at: datetime
    # 변수 의미: 캐시 만료 시각이다.
    expires_at: datetime
    # 변수 의미: 캐시 원천 상태다.
    source_status: str


@dataclass(frozen=True)
class QuestTemplate:
    """
    입력: 카테고리별 퀘스트 생성 정책.
    출력: 관광지 후보에 적용할 템플릿 객체.
    역할: Gemini 없이도 검증 가능한 baseline 퀘스트를 만든다.
    호출 예시: template = QUEST_TEMPLATES["nature"]
    """

    # 변수 의미: Questbook 카테고리 코드다.
    category_code: str
    # 변수 의미: 퀘스트 유형이다.
    quest_type: str
    # 변수 의미: 인증 방식이다.
    verification_type: str
    # 변수 의미: 완료 보상 XP다.
    reward_xp: int
    # 변수 의미: 제목 템플릿이다.
    title_template: str
    # 변수 의미: 설명 템플릿이다.
    description_template: str
