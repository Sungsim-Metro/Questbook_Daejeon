-- 기존 관심사 값을 보존하면서 사용자가 명시적으로 설정한 시각을 구분한다.

BEGIN;

ALTER TABLE preferences
  ADD COLUMN IF NOT EXISTS categories_set_at TIMESTAMPTZ;

COMMIT;
