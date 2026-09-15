-- Questbook baseline PostgreSQL 스키마를 정의한다.

CREATE TABLE IF NOT EXISTS categories (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  nickname TEXT NOT NULL,
  avatar TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  last_active_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  categories_json JSONB NOT NULL,
  distance_range_meters INTEGER NOT NULL,
  pace TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS level_progress (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  current_level INTEGER NOT NULL,
  current_xp INTEGER NOT NULL,
  total_xp INTEGER NOT NULL,
  next_level_required_xp INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_accounts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_user_id TEXT NOT NULL,
  email TEXT,
  display_name TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  last_login_at TIMESTAMPTZ NOT NULL,
  UNIQUE(provider, provider_user_id)
);

CREATE TABLE IF NOT EXISTS user_consents (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  age_confirmed BOOLEAN NOT NULL,
  privacy_consent BOOLEAN NOT NULL,
  location_consent BOOLEAN NOT NULL,
  consent_version TEXT NOT NULL,
  consented_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS badge_definitions (
  id TEXT PRIMARY KEY,
  category_code TEXT NOT NULL REFERENCES categories(code),
  name TEXT NOT NULL,
  tier INTEGER NOT NULL,
  required_xp INTEGER NOT NULL,
  icon TEXT NOT NULL,
  color TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  UNIQUE(category_code, tier)
);

CREATE TABLE IF NOT EXISTS user_badges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_definition_id TEXT NOT NULL REFERENCES badge_definitions(id),
  progress_xp INTEGER NOT NULL,
  earned_at TIMESTAMPTZ,
  UNIQUE(user_id, badge_definition_id)
);

CREATE TABLE IF NOT EXISTS reusable_quests (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  type TEXT NOT NULL,
  category_code TEXT NOT NULL REFERENCES categories(code),
  reward_xp INTEGER NOT NULL,
  verification_type TEXT NOT NULL,
  place_content_id TEXT NOT NULL,
  place_name TEXT NOT NULL,
  source TEXT NOT NULL,
  review_status TEXT NOT NULL,
  created_for_user_id TEXT NOT NULL REFERENCES users(id),
  is_reusable BOOLEAN NOT NULL,
  reuse_count INTEGER NOT NULL,
  completion_count INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(place_content_id, category_code, type)
);

CREATE TABLE IF NOT EXISTS user_quest_instances (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reusable_quest_id TEXT NOT NULL REFERENCES reusable_quests(id),
  status TEXT NOT NULL,
  recommended_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_user_quest_instances_user_status
  ON user_quest_instances(user_id, status);

CREATE TABLE IF NOT EXISTS quest_completions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_quest_instance_id TEXT NOT NULL REFERENCES user_quest_instances(id),
  reusable_quest_id TEXT NOT NULL REFERENCES reusable_quests(id),
  completed_at TIMESTAMPTZ NOT NULL,
  earned_xp INTEGER NOT NULL,
  verification_result_json JSONB NOT NULL,
  photo_ref TEXT,
  note_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_quest_completions_user
  ON quest_completions(user_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_quest_completions_instance
  ON quest_completions(user_quest_instance_id);

CREATE TABLE IF NOT EXISTS adventure_notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reusable_quest_id TEXT NOT NULL REFERENCES reusable_quests(id),
  quest_completion_id TEXT NOT NULL REFERENCES quest_completions(id),
  place_name TEXT NOT NULL,
  summary TEXT NOT NULL,
  badges_json JSONB NOT NULL,
  distance_km DOUBLE PRECISION NOT NULL,
  share_image_url TEXT,
  entry_type TEXT NOT NULL DEFAULT 'diary' CHECK (entry_type IN ('diary', 'review')),
  entry_title TEXT NOT NULL DEFAULT '',
  entry_body TEXT NOT NULL DEFAULT '',
  entry_rating SMALLINT CHECK (entry_rating IS NULL OR entry_rating BETWEEN 1 AND 5),
  entry_updated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_adventure_notes_user_created
  ON adventure_notes(user_id, created_at);

CREATE TABLE IF NOT EXISTS ggumdori_variants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  theme_category TEXT NOT NULL REFERENCES categories(code),
  tier INTEGER NOT NULL,
  unlock_condition TEXT NOT NULL,
  image_ref TEXT NOT NULL,
  description TEXT NOT NULL,
  rarity TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  UNIQUE(theme_category, tier)
);

CREATE TABLE IF NOT EXISTS user_ggumdori (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  variant_id TEXT NOT NULL REFERENCES ggumdori_variants(id),
  unlocked_at TIMESTAMPTZ NOT NULL,
  UNIQUE(user_id, variant_id)
);

CREATE TABLE IF NOT EXISTS ggumdori_selection (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  selected_variant_id TEXT NOT NULL REFERENCES ggumdori_variants(id),
  updated_at TIMESTAMPTZ NOT NULL
);
