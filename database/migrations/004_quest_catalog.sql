-- 사용자 수락·완료 사본을 보존하고 일일 퀘스트 카탈로그를 추가한다.
-- API 실패 폴백과 전역 좌표 검색 정책은 변경하지 않는다.
BEGIN;

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
SET quest_snapshot_json = 
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

FROM reusable_quests rq
WHERE uqi.reusable_quest_id = rq.id
  AND uqi.status IN ('accepted', 'in_progress', 'completed')
  AND uqi.quest_snapshot_json IS NULL;


CREATE TABLE IF NOT EXISTS tourism_catalog_places (
  content_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  category_code TEXT NOT NULL REFERENCES categories(code),
  first_seen_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL,
  missing_since TIMESTAMPTZ,
  missing_observations INTEGER NOT NULL DEFAULT 0 CHECK (missing_observations >= 0),
  last_missing_date DATE
);

CREATE TABLE IF NOT EXISTS catalog_sync_runs (
  run_date DATE PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  started_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ,
  stats_json JSONB NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE reusable_quests
  ADD COLUMN IF NOT EXISTS catalog_managed BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE reusable_quests
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE reusable_quests ALTER COLUMN created_for_user_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_catalog_managed_quests
  ON reusable_quests(place_content_id) WHERE catalog_managed;

COMMIT;
