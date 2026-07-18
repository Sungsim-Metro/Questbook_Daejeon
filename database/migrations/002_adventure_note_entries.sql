-- 기존 모험가의 수첩 기록에 사용자 일기·리뷰 필드를 안전하게 추가한다.

BEGIN;

ALTER TABLE adventure_notes
  ADD COLUMN IF NOT EXISTS entry_type TEXT,
  ADD COLUMN IF NOT EXISTS entry_title TEXT,
  ADD COLUMN IF NOT EXISTS entry_body TEXT,
  ADD COLUMN IF NOT EXISTS entry_rating SMALLINT,
  ADD COLUMN IF NOT EXISTS entry_updated_at TIMESTAMPTZ;

UPDATE adventure_notes
SET
  entry_type = COALESCE(entry_type, 'diary'),
  entry_title = COALESCE(entry_title, ''),
  entry_body = COALESCE(entry_body, '')
WHERE entry_type IS NULL
   OR entry_title IS NULL
   OR entry_body IS NULL;

ALTER TABLE adventure_notes
  ALTER COLUMN entry_type SET DEFAULT 'diary',
  ALTER COLUMN entry_type SET NOT NULL,
  ALTER COLUMN entry_title SET DEFAULT '',
  ALTER COLUMN entry_title SET NOT NULL,
  ALTER COLUMN entry_body SET DEFAULT '',
  ALTER COLUMN entry_body SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'adventure_notes_entry_type_check'
      AND conrelid = 'adventure_notes'::regclass
  ) THEN
    ALTER TABLE adventure_notes
      ADD CONSTRAINT adventure_notes_entry_type_check
      CHECK (entry_type IN ('diary', 'review')) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'adventure_notes_entry_rating_check'
      AND conrelid = 'adventure_notes'::regclass
  ) THEN
    ALTER TABLE adventure_notes
      ADD CONSTRAINT adventure_notes_entry_rating_check
      CHECK (entry_rating IS NULL OR entry_rating BETWEEN 1 AND 5) NOT VALID;
  END IF;
END
$$;

ALTER TABLE adventure_notes
  VALIDATE CONSTRAINT adventure_notes_entry_type_check;

ALTER TABLE adventure_notes
  VALIDATE CONSTRAINT adventure_notes_entry_rating_check;

COMMIT;
