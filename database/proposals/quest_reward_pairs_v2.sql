-- 미적용 제안: 현재 통합은 카테고리 XP 보상을 유지하므로 이 SQL을 실행하지 않는다.
-- 보상 정책과 데이터 이관을 별도 승인한 뒤 마이그레이션으로 검토한다.
-- v2 보상 모델: 퀘스트 1개 = 고유 미니 뱃지 1개 + 고유 꿈돌이 1개. (명세 §5.1)
--
-- 왜 필요한가
--   001 의 badge_definitions / ggumdori_variants 는 UNIQUE(category, tier) 라
--   카테고리당 3개가 상한이다. 명세 §5.2 "퀘스트가 공개되면 도감 항목이 끝에 추가되고
--   전체 수가 줄지 않는다" 를 그 구조로는 만족할 수 없다.
--   그래서 보상을 카테고리가 아니라 퀘스트에 매단다.
--
-- 도감 노출 규칙 (명세 §5.2)
--   - draft      : 도감에 나타나지 않는다. 슬롯을 미리 만들어 둘 때 쓴다.
--   - published  : 도감에 나타난다. 이 순간 catalog_order 가 확정된다.
--   - paused     : 지금은 획득할 수 없지만 슬롯과 순서를 유지한다.
--   - retired    : 종료됐지만 슬롯과 순서를 유지한다. hard delete 하지 않는다.
--   totalCount 는 published + paused + retired 를 센다. draft 는 세지 않는다.

BEGIN;

-- 1) v2 카테고리 8종을 채운다. v1 코드는 아래에서 옮긴다. (명세 §4.1)
INSERT INTO categories (code, name, description, sort_order) VALUES
  ('science',  '과학·우주',   '연구단지와 과학관 중심 테마', 1),
  ('bread',    '빵·미식',     '빵집과 지역 미식 테마',       2),
  ('nature',   '자연·산책',   '수목원과 하천 산책 테마',     3),
  ('heritage', '원도심·역사', '원도심과 근대문화 테마',      4),
  ('culture',  '문화·예술',   '공연과 전시 테마',            5),
  ('market',   '시장·상권',   '전통시장과 골목상권 테마',    6),
  ('tashu',    '이동·타슈',   '공공자전거와 이동 테마',      7),
  ('festival', '축제·이벤트', '축제와 계절 행사 테마',       8)
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      sort_order = EXCLUDED.sort_order;

-- 2) v1 카테고리를 v2 로 옮긴다. 프론트의 LEGACY_CATEGORY_MAP 과 같은 표다.
UPDATE reusable_quests SET category_code = 'heritage' WHERE category_code = 'downtown';
UPDATE reusable_quests SET category_code = 'tashu'    WHERE category_code = 'mobility';
UPDATE reusable_quests SET category_code = 'culture'  WHERE category_code = 'nightview';

-- 3) 퀘스트별 보상 쌍. 퀘스트 하나에 정확히 한 행이다. (명세 §5.1 1:1:1)
CREATE TABLE IF NOT EXISTS quest_rewards (
  quest_id TEXT PRIMARY KEY REFERENCES reusable_quests(id) ON DELETE RESTRICT,

  -- 도감 노출 상태. draft 는 도감에 나오지 않는다. (명세 §5.2)
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'paused', 'retired')),

  -- 도감 정렬 순서. 공개 시점에 부여하고 이후 바꾸지 않는다. (명세 §10 S09)
  catalog_order INTEGER,

  -- 미니 뱃지. 경로는 서버가 내려주고 클라이언트는 계산하지 않는다. (명세 §5.1)
  badge_name TEXT NOT NULL,
  badge_image_ref TEXT NOT NULL,

  -- 고유 꿈돌이. asset_id 는 파이프라인 매니페스트의 키와 같다.
  ggumdori_asset_id TEXT NOT NULL UNIQUE,
  ggumdori_name TEXT NOT NULL,
  ggumdori_still_image_ref TEXT NOT NULL,
  -- 눈 깜빡임 프레임. 없으면 빈 문자열이고 앱은 정지 그림만 쓴다. (명세 §5.4)
  ggumdori_blink_image_ref TEXT NOT NULL DEFAULT '',
  ggumdori_thumb_image_ref TEXT NOT NULL DEFAULT '',

  -- 미획득 카드에 보여 줄 정확한 해금 조건. (명세 §5.3)
  unlock_description TEXT NOT NULL DEFAULT '',

  published_at TIMESTAMPTZ,
  retired_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- 공개된 항목은 반드시 정렬 순서를 가진다.
  CONSTRAINT published_needs_order
    CHECK (status = 'draft' OR catalog_order IS NOT NULL)
);

-- 도감은 공개 순서대로 읽는다. draft 는 조회에서 빠지므로 부분 인덱스로 충분하다.
CREATE UNIQUE INDEX IF NOT EXISTS quest_rewards_catalog_order_idx
  ON quest_rewards (catalog_order)
  WHERE catalog_order IS NOT NULL;

CREATE INDEX IF NOT EXISTS quest_rewards_status_idx ON quest_rewards (status);

-- 4) 사용자가 획득한 꿈돌이를 퀘스트 보상 기준으로 다시 잡는다.
--    001 의 user_ggumdori 는 ggumdori_variants(카테고리×등급)를 가리켜 v2 와 맞지 않는다.
CREATE TABLE IF NOT EXISTS user_quest_rewards (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  quest_id TEXT NOT NULL REFERENCES quest_rewards(quest_id),
  earned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 첫 완료에만 보상을 지급한다. 중복 지급을 막는다. (명세 §5.1, §11.2)
  UNIQUE (user_id, quest_id)
);

CREATE INDEX IF NOT EXISTS user_quest_rewards_user_idx ON user_quest_rewards (user_id);

-- 5) 공통 축제의 실제 방문 회차. 추가 방문은 보상 없이 기록만 남는다. (명세 §11.1, §11.2)
CREATE TABLE IF NOT EXISTS festival_visits (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 공통 축제 퀘스트의 정본 식별자다. (명세 §11.1)
  canonical_quest_id TEXT NOT NULL REFERENCES reusable_quests(id),
  event_id TEXT NOT NULL,
  -- 같은 축제의 연도·회차를 구분한다. (명세 §16.2)
  edition_id TEXT NOT NULL,
  event_title TEXT NOT NULL,
  venue_name TEXT NOT NULL DEFAULT '',
  visited_at TIMESTAMPTZ NOT NULL,
  -- 보상을 준 첫 완료인지, 기록만 남긴 추가 방문인지 구분한다. (명세 §11.2)
  is_reward_granted BOOLEAN NOT NULL DEFAULT false,
  -- 동일 사용자·동일 회차의 중복 기록을 막는다. (명세 §11.1)
  UNIQUE (user_id, event_id, edition_id)
);

CREATE INDEX IF NOT EXISTS festival_visits_user_idx ON festival_visits (user_id);

COMMIT;
