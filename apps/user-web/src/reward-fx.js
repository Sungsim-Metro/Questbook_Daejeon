// GPS 인증 성공 연출의 DOM 조립을 담당하는 파일입니다 (지침서 T2-B).
// 타이밍과 모션은 전부 reward-fx.css 가 가지고 있습니다. 이 파일은 노드만 만듭니다.
//
// 연출 트리거는 "마운트" 입니다. 보상 노드를 새로 붙이는 순간 CSS 애니메이션이
// 처음부터 돕니다. 클래스를 토글하거나 setTimeout 으로 단계를 쪼개지 마세요.

// 뱃지 이미지의 기준 경로입니다.
const BADGE_BASE = "/assets/badge";

// 화면 카테고리를 뱃지 에셋 카테고리로 옮기는 표입니다.
// 앱은 9종(CATEGORY_LABELS), 에셋은 taxonomy.json 의 8종이라 이름이 1:1이 아닙니다.
const BADGE_CATEGORY_BY_VIEW_CATEGORY = {
  nature: "nature",
  science: "science",
  market: "market",
  mobility: "tashu",
  downtown: "heritage",
  // 아래 3종은 대응하는 에셋 카테고리가 없어 가까운 것으로 임시 지정했습니다.
  hotspring: "festival",
  nightview: "culture",
  default: "culture",
};

// 대응표에 없는 카테고리에 쓸 기본 뱃지 카테고리입니다.
const FALLBACK_BADGE_CATEGORY = "culture";

// 반짝임 8방향의 각도입니다.
const SPARK_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

/**
 * 입력: 화면 카테고리 코드와 뱃지 등급.
 * 출력: 뱃지 PNG 경로.
 * 역할: 카테고리와 등급을 실제 뱃지 에셋 파일 이름으로 바꾼다.
 * 호출 예시: getBadgeImageSrc("nature", 2)
 */
export function getBadgeImageSrc(category, tier) {
  // 뱃지 에셋 카테고리입니다.
  const assetCategory = BADGE_CATEGORY_BY_VIEW_CATEGORY[category] || FALLBACK_BADGE_CATEGORY;
  // 1~3 범위로 자른 등급입니다.
  const level = Math.min(3, Math.max(1, Number(tier) || 1));
  return `${BADGE_BASE}/badge_${assetCategory}_lv${level}_64.png`;
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 화면 전체 흰색 플래시를 한 번 재생하고 스스로 사라진다.
 * 호출 예시: playRewardFlash()
 */
export function playRewardFlash() {
  // 플래시 요소입니다. pointer-events 가 없어 화면 조작을 막지 않습니다.
  const flash = document.createElement("div");
  flash.className = "reward-flash";
  document.body.append(flash);
  flash.addEventListener("animationend", () => flash.remove(), { once: true });
  // 모션을 끈 사용자는 animationend 가 오지 않으므로 안전망을 둡니다.
  window.setTimeout(() => flash.remove(), 400);
}

/**
 * 입력: 뱃지 표시 정보.
 * 출력: 연출 노드.
 * 역할: 뱃지, 반짝임, 꿈돌이 cheer, 획득 문구를 한 덩어리로 만든다.
 * 호출 예시: createRewardFx({ name: "초록 탐험가", category: "nature", tier: 1 })
 */
export function createRewardFx({ name = "탐험 뱃지", category = "default", tier = 1 } = {}) {
  // 연출 전체를 담는 요소입니다.
  const root = document.createElement("div");
  root.className = "reward-fx";

  // 뱃지와 반짝임이 같은 중심을 쓰도록 묶는 요소입니다.
  const stage = document.createElement("div");
  stage.className = "badge-stage";

  SPARK_ANGLES.forEach((angle) => {
    // 방사형 반짝임 한 점입니다.
    const spark = document.createElement("span");
    spark.className = "spark";
    spark.style.setProperty("--a", `${angle}deg`);
    stage.append(spark);
  });

  // 획득한 뱃지 이미지입니다.
  const badge = document.createElement("img");
  badge.className = "badge-reward";
  badge.src = getBadgeImageSrc(category, tier);
  badge.alt = `${name} 뱃지`;
  // CSS 가 정수 2배(128px)로 키운다. 속성값도 맞춰 두면 CSS 로드 전 흔들림이 없다.
  badge.width = 128;
  badge.height = 128;
  stage.append(badge);

  // 환호하는 꿈돌이 스프라이트입니다.
  const dumdori = document.createElement("div");
  dumdori.className = "dumdori-cheer";
  dumdori.setAttribute("role", "img");
  dumdori.setAttribute("aria-label", "꿈돌이가 환호합니다");

  // 획득 문구입니다.
  const label = document.createElement("p");
  label.className = "reward-label";
  // 뱃지 이름 요소입니다.
  const labelName = document.createElement("span");
  labelName.className = "reward-badge-name";
  labelName.textContent = name;
  // 뱃지 등급 요소입니다.
  const labelTier = document.createElement("span");
  labelTier.className = "reward-badge-tier";
  labelTier.textContent = `새 뱃지 획득 · Lv.${Math.min(3, Math.max(1, Number(tier) || 1))}`;
  label.append(labelName, labelTier);

  root.append(stage, dumdori, label);
  return root;
}
