// 에셋 매니페스트를 읽어 quest_rewards 시드 SQL 을 만듭니다.
//
//   node scripts/build_ggumdori_assets.mjs      # 이미지 + manifest.json
//   node scripts/seed_quest_rewards.mjs         # manifest.json -> SQL
//   psql "$DATABASE_URL" -f database/seeds/003_quest_rewards.generated.sql
//
// 왜 SQL 파일로 뽑는가
//   저장소에 package.json 이 없어 DB 드라이버를 깔 수 없습니다. 대신 검토 가능한
//   SQL 을 만들어 기존 마이그레이션과 같은 방식으로 적용합니다.
//
// 되돌려 실행해도 안전합니다. asset_id 기준 UPSERT 라 PNG 를 추가하고 다시 돌리면
// 새 항목만 늘어납니다. 이미 공개된 항목의 catalog_order 는 건드리지 않습니다. (명세 §5.2)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = path.join(ROOT, "apps", "user-web", "public", "assets", "ggumdori", "manifest.json");
const MAPPING = path.join(ROOT, "assets-src", "ggumdori", "quest-mapping.json");
const OUT = path.join(ROOT, "database", "seeds", "003_quest_rewards.generated.sql");

/**
 * 입력: 문자열.
 * 출력: 작은따옴표를 이스케이프한 SQL 리터럴.
 * 역할: 생성 SQL 에 문자열을 안전하게 넣는다.
 * 호출 예시: quote("대전 '빵' 축제")
 */
function quote(value) {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 매니페스트와 퀘스트 매핑을 합쳐 UPSERT SQL 을 만든다.
 * 호출 예시: node scripts/seed_quest_rewards.mjs
 */
function main() {
  if (!fs.existsSync(MANIFEST)) {
    console.error(`매니페스트가 없습니다: ${MANIFEST}`);
    console.error("먼저 node scripts/build_ggumdori_assets.mjs 를 실행하세요.");
    process.exitCode = 1;
    return;
  }

  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));

  // 에셋을 어느 퀘스트에 붙일지 적은 표입니다. 없으면 빈 표로 시작합니다.
  const mapping = fs.existsSync(MAPPING) ? JSON.parse(fs.readFileSync(MAPPING, "utf8")) : {};

  // 아직 퀘스트에 연결되지 않은 에셋들입니다.
  const unmapped = [];
  // 만들어 낼 SQL 구문들입니다.
  const statements = [];

  for (const entry of manifest.entries) {
    // 이 에셋에 연결된 퀘스트 정보입니다.
    const link = mapping[entry.assetId];

    if (!link?.questId) {
      unmapped.push(entry.assetId);
      continue;
    }

    statements.push(
      [
        "INSERT INTO quest_rewards (",
        "  quest_id, status, catalog_order,",
        "  badge_name, badge_image_ref,",
        "  ggumdori_asset_id, ggumdori_name,",
        "  ggumdori_still_image_ref, ggumdori_blink_image_ref, ggumdori_thumb_image_ref,",
        "  unlock_description, published_at, updated_at",
        ") VALUES (",
        `  ${quote(link.questId)},`,
        `  ${quote(link.status || "draft")},`,
        // 공개 항목은 지금 있는 가장 큰 순서 다음을 받습니다. 끝에 추가합니다. (명세 §5.2)
        link.status === "published"
          ? "  COALESCE((SELECT MAX(catalog_order) FROM quest_rewards), 0) + 1,"
          : "  NULL,",
        `  ${quote(link.badgeName || entry.assetId)},`,
        `  ${quote(link.badgeImageRef || "")},`,
        `  ${quote(entry.assetId)},`,
        `  ${quote(link.ggumdoriName || entry.assetId)},`,
        `  ${quote(entry.stillImageRef)},`,
        `  ${quote(entry.blinkImageRef)},`,
        `  ${quote(entry.thumbImageRef)},`,
        `  ${quote(link.unlockDescription || "")},`,
        link.status === "published" ? "  now()," : "  NULL,",
        "  now()",
        ")",
        "ON CONFLICT (ggumdori_asset_id) DO UPDATE SET",
        // 이미지 경로는 다시 구울 때마다 갱신합니다.
        "  ggumdori_still_image_ref = EXCLUDED.ggumdori_still_image_ref,",
        "  ggumdori_blink_image_ref = EXCLUDED.ggumdori_blink_image_ref,",
        "  ggumdori_thumb_image_ref = EXCLUDED.ggumdori_thumb_image_ref,",
        "  badge_image_ref = EXCLUDED.badge_image_ref,",
        "  updated_at = now();",
        // catalog_order 와 status 는 일부러 덮어쓰지 않습니다.
        // 한번 공개된 항목의 순서를 바꾸면 도감이 흔들립니다. (명세 §5.2)
      ].join("\n"),
    );
  }

  const header = [
    "-- 이 파일은 scripts/seed_quest_rewards.mjs 가 생성합니다. 직접 고치지 마세요.",
    `-- 원본 매니페스트: ${path.relative(ROOT, MANIFEST).replace(/\\/g, "/")}`,
    `-- 생성 시각: ${new Date().toISOString()}`,
    "",
    "BEGIN;",
    "",
  ].join("\n");

  fs.writeFileSync(OUT, `${header}${statements.join("\n\n")}\n\nCOMMIT;\n`);

  console.log(`${statements.length}개 보상 쌍 SQL 생성 → ${path.relative(ROOT, OUT).replace(/\\/g, "/")}`);

  if (unmapped.length > 0) {
    console.log(`\n퀘스트에 아직 연결되지 않은 에셋 ${unmapped.length}개:`);
    console.log(`  ${unmapped.join(", ")}`);
    console.log(`\n${path.relative(ROOT, MAPPING).replace(/\\/g, "/")} 에 아래 형식으로 적으세요.`);
    console.log(
      JSON.stringify(
        {
          [unmapped[0]]: {
            questId: "quest-science-001",
            status: "published",
            badgeName: "과학 탐험가",
            badgeImageRef: "/assets/badge/badge_science_lv1_64.png",
            ggumdoriName: "연구원 꿈돌이",
            unlockDescription: "국립중앙과학관에서 과학 키워드 3개 수집을 완료하면 얻어요.",
          },
        },
        null,
        2,
      ),
    );
  }
}

main();
