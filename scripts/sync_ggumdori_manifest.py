"""서버의 테마·레벨 등록부에서 중복 없는 공개 이미지 목록을 만든다. 원본 이미지는 보존한다."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services/app-api/src"))
from questbook_api.domain.ggumdori_rewards import GGUMDORI_SEEDS, THEMES


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    categories = {code: ui for code, ui, *_ in THEMES}
    entries = []
    for variant_id, name, category, tier, condition, image_ref, *_ in GGUMDORI_SEEDS:
        image = ROOT / "apps/user-web/public" / image_ref.lstrip("/")
        if not image.is_file():
            raise FileNotFoundError(f"Missing catalog image: {image_ref}")
        entry = {
            "assetId": image.stem, "variantId": variant_id, "name": name,
            "category": categories.get(category, category), "tier": tier,
            "requiredCount": 0 if category == "default" else tier,
            "unlockCondition": condition, "stillImageRef": image_ref,
            "thumbImageRef": image_ref,
        }
        if image.with_suffix(".gif").is_file():
            entry["animationImageRef"] = image_ref.replace(".png", ".gif")
        detail_ref = image_ref.replace("_128.png", "_1024.png")
        if (ROOT / "apps/user-web/public" / detail_ref.lstrip("/")).is_file():
            entry["detailImageRef"] = detail_ref
        entries.append(entry)
    payload = {"version": 2, "unlockPolicy": "category-completions", "entries": entries}
    target = ROOT / "apps/user-web/public/assets/ggumdori/manifest.json"
    if args.check:
        if json.loads(target.read_text(encoding="utf-8")) != payload:
            raise SystemExit("Catalog manifest is out of date; run scripts/sync_ggumdori_manifest.py")
    else:
        target.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Validated {len(entries)} unique variants and their image paths.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
