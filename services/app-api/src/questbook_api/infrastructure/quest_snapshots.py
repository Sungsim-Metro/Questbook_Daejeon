# 공용 퀘스트 삭제와 독립적인 사용자별 퀘스트·관광지 사본을 정의한다.
from __future__ import annotations

import math
from typing import Any

from questbook_api.domain.models import TourPlaceCandidate


# 변수 의미: 공용 퀘스트에서 사용자 사본으로 고정하는 SQL 표현식이다.
QUEST_SNAPSHOT_EXPRESSION = """
jsonb_build_object(
    'reusable_quest_id', rq.id,
    'title', rq.title, 'description', rq.description, 'type', rq.type,
    'category_code', rq.category_code, 'reward_xp', rq.reward_xp,
    'verification_type', rq.verification_type,
    'place_content_id', rq.place_content_id, 'place_name', rq.place_name,
    'source', rq.source, 'review_status', rq.review_status,
    'version', COALESCE(to_jsonb(rq)->'version', '1'::jsonb),
    'allowed_radius_meters', 50
)
"""

# 변수 의미: 기존 데이터 보존과 공용 참조 분리를 위한 재실행 가능한 스키마다.
SNAPSHOT_SCHEMA_SQL = """
ALTER TABLE user_quest_instances
  ADD COLUMN IF NOT EXISTS quest_snapshot_json JSONB;
ALTER TABLE user_quest_instances
  ADD COLUMN IF NOT EXISTS place_snapshot_json JSONB;

DO $$
DECLARE
  target_table TEXT;
  old_constraint RECORD;
BEGIN
  FOREACH target_table IN ARRAY ARRAY['user_quest_instances', 'quest_completions', 'adventure_notes']
  LOOP
    EXECUTE format('ALTER TABLE %I ALTER COLUMN reusable_quest_id DROP NOT NULL', target_table);
    FOR old_constraint IN
      SELECT conname FROM pg_constraint
      WHERE conrelid = target_table::regclass
        AND confrelid = 'reusable_quests'::regclass
        AND contype = 'f' AND confdeltype <> 'n'
    LOOP
      EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', target_table, old_constraint.conname);
    END LOOP;
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = target_table::regclass
        AND confrelid = 'reusable_quests'::regclass AND contype = 'f'
    ) THEN
      EXECUTE format(
        'ALTER TABLE %I ADD FOREIGN KEY (reusable_quest_id) REFERENCES reusable_quests(id) ON DELETE SET NULL',
        target_table
      );
    END IF;
  END LOOP;
END
$$;

UPDATE user_quest_instances uqi
SET quest_snapshot_json = """ + QUEST_SNAPSHOT_EXPRESSION + """
FROM reusable_quests rq
WHERE uqi.reusable_quest_id = rq.id
  AND uqi.status IN ('accepted', 'in_progress', 'completed')
  AND uqi.quest_snapshot_json IS NULL;
"""


def place_snapshot(place: TourPlaceCandidate | None) -> dict[str, Any] | None:
    """
    입력: 서버가 조회한 관광지 또는 None.
    출력: 사용자 퀘스트에 필요한 최소 장소 정보 또는 None.
    역할: 원본 설명과 거리·이미지를 복사하지 않고 장소 식별·인증 정보를 보존한다.
    호출 예시: snapshot = place_snapshot(place)
    """
    if place is None:
        return None
    if (
        not math.isfinite(place.latitude) or not -90 <= place.latitude <= 90
        or not math.isfinite(place.longitude) or not -180 <= place.longitude <= 180
    ):
        raise ValueError("Invalid quest place coordinates.")
    return {
        "contentId": place.content_id, "title": place.title,
        "latitude": place.latitude, "longitude": place.longitude,
        "categoryCode": place.category_code, "categoryName": place.category_name,
        "source": place.source,
    }
