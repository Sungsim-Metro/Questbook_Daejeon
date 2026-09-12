// 꿈돌이 원본 PNG 를 앱이 쓰는 에셋으로 굽는 파이프라인입니다.
//
//   assets-src/ggumdori/*.png                      원본을 여기에 넣습니다.
//        │  node scripts/build_ggumdori_assets.mjs
//        ▼
//   apps/user-web/public/assets/ggumdori/
//        <id>.png         128px 누끼 정지 프레임
//        <id>-blink.png   눈 감은 프레임
//        <id>-thumb.png   64px 목록용
//        manifest.json    DB 시딩이 읽는 산출물
//
// 하는 일: 배경 제거 → 여백 잘라내기 → 축소 → 색 정리 → 눈 탐지 → 깜빡임 프레임.
// 눈 좌표는 자동 탐지하되, manifest.overrides.json 에 적으면 그 값이 이깁니다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng, encodePng, createImage, getPixel, setPixel } from "./lib/png.mjs";

// 저장소 루트입니다.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC_DIR = path.join(ROOT, "assets-src", "ggumdori");
const OUT_DIR = path.join(ROOT, "apps", "user-web", "public", "assets", "ggumdori");
const OVERRIDE_FILE = path.join(SRC_DIR, "manifest.overrides.json");

// 산출물 크기입니다.
const FULL_SIZE = 128;
const THUMB_SIZE = 64;

// 배경으로 볼 색 허용 오차입니다. AI 생성 이미지의 흰 배경에 노이즈가 있어 넉넉히 잡습니다.
const BACKGROUND_TOLERANCE = 26;

/**
 * 입력: 이미지.
 * 출력: 배경이 투명해진 이미지.
 * 역할: 가장자리에서 번져 들어가며 바깥 배경만 지운다. 캐릭터 안쪽 흰색은 남긴다.
 * 호출 예시: removeBackground(image)
 */
function removeBackground(image) {
  const { width: w, height: h } = image;
  // 모서리 색을 배경색으로 봅니다.
  const bg = getPixel(image, 0, 0);
  // 배경과 충분히 비슷한 색인지 판단합니다.
  const isBackground = (p) =>
    Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]) <= BACKGROUND_TOLERANCE;

  // 이미 확인한 픽셀 표시입니다.
  const seen = new Uint8Array(w * h);
  // 확인할 좌표 더미입니다. 네 변에서 시작합니다.
  const stack = [];
  for (let x = 0; x < w; x++) {
    stack.push(x, 0, x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    stack.push(0, y, w - 1, y);
  }

  while (stack.length) {
    const y = stack.pop();
    const x = stack.pop();
    if (x < 0 || y < 0 || x >= w || y >= h) {
      continue;
    }
    const k = y * w + x;
    if (seen[k] || !isBackground(getPixel(image, x, y))) {
      continue;
    }
    seen[k] = 1;
    setPixel(image, x, y, [0, 0, 0, 0]);
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }

  return image;
}

/**
 * 입력: 이미지.
 * 출력: 투명 여백을 잘라낸 이미지.
 * 역할: 캐릭터가 프레임을 꽉 채우게 한다.
 * 호출 예시: trim(image)
 */
function trim(image) {
  const { width: w, height: h } = image;
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (getPixel(image, x, y)[3] > 8) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (minX > maxX) {
    return image;
  }

  // 잘라낸 결과 이미지입니다.
  const out = createImage(maxX - minX + 1, maxY - minY + 1);
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      setPixel(out, x, y, getPixel(image, x + minX, y + minY));
    }
  }
  return out;
}

/**
 * 입력: 이미지와 목표 한 변 길이.
 * 출력: 축소한 이미지.
 * 역할: 알파 가중 박스 필터로 줄여 테두리가 번지지 않게 한다.
 * 호출 예시: downsample(image, 128)
 */
function downsample(image, target) {
  // 긴 변 기준 축소 배율입니다.
  const scale = Math.max(image.width, image.height) / target;
  const w = Math.max(1, Math.round(image.width / scale));
  const h = Math.max(1, Math.round(image.height / scale));
  const out = createImage(w, h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // 원본에서 이 결과 픽셀이 덮는 범위입니다.
      const x0 = Math.floor(x * scale);
      const x1 = Math.min(image.width, Math.max(x0 + 1, Math.ceil((x + 1) * scale)));
      const y0 = Math.floor(y * scale);
      const y1 = Math.min(image.height, Math.max(y0 + 1, Math.ceil((y + 1) * scale)));

      let r = 0;
      let g = 0;
      let b = 0;
      let alphaSum = 0;
      // 불투명도로 가중한 표본 수입니다. 투명 픽셀이 색을 흐리지 않게 합니다.
      let weight = 0;

      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const p = getPixel(image, sx, sy);
          const a = p[3] / 255;
          r += p[0] * a;
          g += p[1] * a;
          b += p[2] * a;
          alphaSum += p[3];
          weight += a;
        }
      }

      const count = (x1 - x0) * (y1 - y0);
      const alpha = Math.round(alphaSum / count);
      if (weight > 0) {
        setPixel(out, x, y, [Math.round(r / weight), Math.round(g / weight), Math.round(b / weight), alpha]);
      }
    }
  }

  return out;
}

/**
 * 입력: 이미지와 채널당 단계 수.
 * 출력: 색을 줄인 이미지.
 * 역할: 리샘플 노이즈를 걷어내고 픽셀아트의 또렷함을 되살린다.
 * 호출 예시: quantize(image, 5)
 */
function quantize(image, levels = 5) {
  // 한 단계의 색 간격입니다.
  const step = 255 / (levels - 1);

  for (let i = 0; i < image.data.length; i += 4) {
    // 반투명은 남기지 않습니다. 픽셀아트는 경계가 또렷해야 합니다.
    if (image.data[i + 3] < 128) {
      image.data[i + 3] = 0;
      continue;
    }
    image.data[i + 3] = 255;
    for (let c = 0; c < 3; c++) {
      image.data[i + c] = Math.round(Math.round(image.data[i + c] / step) * step);
    }
  }

  return image;
}

/**
 * 입력: 처리된 이미지.
 * 출력: 눈 두 개의 사각 범위 또는 null.
 * 역할: 얼굴 위쪽에서 좌우로 나란한 어두운 덩어리 한 쌍을 찾는다.
 * 호출 예시: const eyes = findEyes(image)
 */
function findEyes(image) {
  const { width: w, height: h } = image;
  // 얼굴이 있을 법한 세로 구간입니다. 머리 장식과 몸통을 피합니다.
  const yTop = Math.floor(h * 0.25);
  const yBottom = Math.floor(h * 0.6);

  // 찾은 어두운 덩어리들입니다.
  const blobs = [];
  const seen = new Uint8Array(w * h);
  // 눈으로 볼 만큼 어두운지 판단합니다.
  const isDark = (p) => p[3] >= 128 && p[0] + p[1] + p[2] <= 180;

  for (let y = yTop; y < yBottom; y++) {
    for (let x = 0; x < w; x++) {
      if (seen[y * w + x] || !isDark(getPixel(image, x, y))) {
        continue;
      }

      // 이 덩어리의 범위와 크기입니다.
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let count = 0;
      const stack = [x, y];

      while (stack.length) {
        const cy = stack.pop();
        const cx = stack.pop();
        if (cx < 0 || cy < yTop || cx >= w || cy >= yBottom) {
          continue;
        }
        const ck = cy * w + cx;
        if (seen[ck] || !isDark(getPixel(image, cx, cy))) {
          continue;
        }
        seen[ck] = 1;
        count++;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        stack.push(cx + 1, cy, cx - 1, cy, cx, cy + 1, cx, cy - 1);
      }

      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      // 눈은 작고 세로로 길쭉하며 속이 찬 덩어리입니다. 윤곽선은 길고 얇아 걸러집니다.
      if (count >= 6 && bw <= w * 0.18 && bh <= h * 0.18 && bh >= bw * 0.8 && count / (bw * bh) > 0.5) {
        blobs.push({ minX, maxX, minY, maxY, count, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 });
      }
    }
  }

  // 큰 덩어리부터 보며 좌우로 나란하고 크기가 비슷한 쌍을 고릅니다.
  blobs.sort((a, b) => b.count - a.count);
  for (let i = 0; i < blobs.length; i++) {
    for (let j = i + 1; j < blobs.length; j++) {
      const a = blobs[i];
      const b = blobs[j];
      const sameRow = Math.abs(a.cy - b.cy) <= Math.max(2, h * 0.03);
      const sameSize = Math.abs(a.count - b.count) / Math.max(a.count, b.count) < 0.45;
      if (sameRow && sameSize) {
        return [a, b].sort((p, q) => p.cx - q.cx);
      }
    }
  }

  return null;
}

/**
 * 입력: 이미지와 눈 범위.
 * 출력: 눈 주변 피부색.
 * 역할: 눈을 덮을 색을 주변 고리에서 중앙값으로 고른다. 한 점만 찍으면 그림자에 걸린다.
 * 호출 예시: sampleSkin(image, eye)
 */
function sampleSkin(image, eye) {
  // 눈 바깥 한 겹의 밝은 색들입니다.
  const samples = [];
  const pad = 3;

  for (let y = eye.minY - pad; y <= eye.maxY + pad; y++) {
    for (let x = eye.minX - pad; x <= eye.maxX + pad; x++) {
      // 눈 안쪽은 건너뜁니다.
      if (x >= eye.minX - 1 && x <= eye.maxX + 1 && y >= eye.minY - 1 && y <= eye.maxY + 1) {
        continue;
      }
      if (x < 0 || y < 0 || x >= image.width || y >= image.height) {
        continue;
      }
      const p = getPixel(image, x, y);
      // 투명하거나 어두운 픽셀(윤곽선)은 피부색 후보가 아닙니다.
      if (p[3] < 128 || p[0] + p[1] + p[2] <= 200) {
        continue;
      }
      samples.push(p);
    }
  }

  if (samples.length === 0) {
    return [255, 255, 255, 255];
  }

  // 밝기 기준 중앙값을 고릅니다.
  samples.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  return samples[Math.floor(samples.length / 2)];
}

/**
 * 입력: 이미지와 눈 범위.
 * 출력: 위아래로 넓힌 눈 범위.
 * 역할: 탐지 때 끊긴 눈 조각까지 덮도록 박스를 키운다.
 *       탐지는 오검출을 피하려고 엄격한 기준을 쓰지만, 덮을 때는 넉넉해야 잔상이 안 남는다.
 * 호출 예시: expandEyeBox(image, eye)
 */
function expandEyeBox(image, eye) {
  // 덮기 판정에 쓰는 느슨한 어두움 기준입니다. 안티에일리어싱된 가장자리까지 포함합니다.
  const isDarkish = (x, y) => {
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) {
      return false;
    }
    const p = getPixel(image, x, y);
    return p[3] >= 128 && p[0] + p[1] + p[2] <= 430;
  };
  // 이 줄에 눈으로 볼 어두운 픽셀이 있는지 봅니다.
  const rowHasDark = (y) => {
    for (let x = eye.minX; x <= eye.maxX; x++) {
      if (isDarkish(x, y)) {
        return true;
      }
    }
    return false;
  };

  const box = { ...eye };
  // 눈 높이의 절반까지만 넓힙니다. 눈썹이나 입까지 번지지 않게 합니다.
  const limit = Math.max(2, Math.round((eye.maxY - eye.minY + 1) * 0.5));

  for (let i = 0; i < limit && rowHasDark(box.minY - 1); i++) {
    box.minY -= 1;
  }
  for (let i = 0; i < limit && rowHasDark(box.maxY + 1); i++) {
    box.maxY += 1;
  }

  box.cy = (box.minY + box.maxY) / 2;
  return box;
}

/**
 * 입력: 이미지와 눈 두 개.
 * 출력: 눈을 감은 새 이미지.
 * 역할: 눈 자리를 피부색으로 덮고 감은 눈 선을 긋는다.
 * 호출 예시: makeBlinkFrame(image, eyes)
 */
function makeBlinkFrame(image, eyes) {
  // 원본을 복사한 결과 이미지입니다.
  const out = createImage(image.width, image.height);
  image.data.copy(out.data);

  for (const detected of eyes) {
    // 탐지 때 끊긴 조각까지 덮도록 넓힌 범위입니다.
    const eye = expandEyeBox(image, detected);
    // 눈 주변 피부색입니다.
    const skin = sampleSkin(image, eye);
    // 안티에일리어싱으로 남는 테두리까지 덮도록 한 칸 넓힙니다.
    const pad = 1;

    for (let y = eye.minY - pad; y <= eye.maxY + pad; y++) {
      for (let x = eye.minX - pad; x <= eye.maxX + pad; x++) {
        if (x < 0 || y < 0 || x >= out.width || y >= out.height) {
          continue;
        }
        // 원래 불투명하던 자리만 덮습니다. 실루엣이 번지지 않게 합니다.
        if (getPixel(image, x, y)[3] < 128) {
          continue;
        }
        setPixel(out, x, y, skin);
      }
    }

    // 감은 눈은 가로선으로 표현합니다.
    // 눈꺼풀은 눈동자보다 넓으므로 좌우로 늘리고, 눈 높이에 맞춰 선을 두껍게 합니다.
    // 그러지 않으면 작은 화면에서 점처럼 보입니다.
    const eyeWidth = eye.maxX - eye.minX + 1;
    const eyeHeight = eye.maxY - eye.minY + 1;
    const grow = Math.max(1, Math.round(eyeWidth * 0.3));
    const thickness = Math.max(1, Math.round(eyeHeight * 0.22));
    const lineY = Math.round(eye.cy);
    const lineColor = [64, 48, 40, 255];

    for (let t = 0; t < thickness; t++) {
      // 선을 눈 중심에 맞춰 위아래로 퍼뜨립니다.
      const y = lineY - Math.floor(thickness / 2) + t;
      for (let x = eye.minX - grow; x <= eye.maxX + grow; x++) {
        if (x < 0 || y < 0 || x >= out.width || y >= out.height) {
          continue;
        }
        // 얼굴 바깥으로 선이 삐져나가지 않게 합니다.
        if (getPixel(image, x, y)[3] < 128) {
          continue;
        }
        setPixel(out, x, y, lineColor);
      }
    }
  }

  return out;
}

/**
 * 입력: 파일 이름.
 * 출력: 에셋 식별자.
 * 역할: 확장자를 떼고 알려진 오타를 바로잡는다.
 * 호출 예시: toAssetId("naturenature-3.png")
 */
function toAssetId(fileName) {
  // 확장자를 뗀 이름입니다.
  const base = path.basename(fileName, path.extname(fileName));
  // 생성 과정에서 접두사가 두 번 붙은 파일을 바로잡습니다.
  const deduped = base.replace(/^([a-z]+)\1-/, "$1-");

  return deduped;
}

/**
 * 입력: 없음.
 * 출력: 없음.
 * 역할: 원본 폴더를 훑어 에셋과 매니페스트를 만든다.
 * 호출 예시: node scripts/build_ggumdori_assets.mjs
 */
function main() {
  if (!fs.existsSync(SRC_DIR)) {
    console.error(`원본 폴더가 없습니다: ${SRC_DIR}`);
    console.error("원본 PNG 를 assets-src/ggumdori/ 에 넣고 다시 실행하세요.");
    process.exitCode = 1;
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 사람이 손으로 고친 눈 좌표입니다. 자동 탐지보다 우선합니다.
  const overrides = fs.existsSync(OVERRIDE_FILE) ? JSON.parse(fs.readFileSync(OVERRIDE_FILE, "utf8")) : {};

  // 처리할 원본 파일 목록입니다.
  const files = fs
    .readdirSync(SRC_DIR)
    .filter((name) => name.toLowerCase().endsWith(".png"))
    .sort();

  if (files.length === 0) {
    console.error(`원본 PNG 가 없습니다: ${SRC_DIR}`);
    process.exitCode = 1;
    return;
  }

  // 매니페스트 항목들입니다.
  const entries = [];
  // 눈을 못 찾은 에셋들입니다. 끝에 모아 알립니다.
  const needsReview = [];
  let sourceBytes = 0;
  let outputBytes = 0;

  for (const file of files) {
    const assetId = toAssetId(file);
    const sourceBuffer = fs.readFileSync(path.join(SRC_DIR, file));
    sourceBytes += sourceBuffer.length;

    // 배경을 지우고 여백을 잘라낸 원본 해상도 이미지입니다.
    const cleaned = trim(removeBackground(decodePng(sourceBuffer)));
    // 앱이 쓰는 정지 프레임입니다.
    const full = quantize(downsample(cleaned, FULL_SIZE));
    // 목록용 썸네일입니다.
    const thumb = quantize(downsample(cleaned, THUMB_SIZE));

    // 눈 좌표입니다. 손으로 적은 값이 있으면 그것을 씁니다.
    const override = overrides[assetId];
    const eyes = override
      ? override.map((box) => ({
          minX: box[0],
          minY: box[1],
          maxX: box[2],
          maxY: box[3],
          cx: (box[0] + box[2]) / 2,
          cy: (box[1] + box[3]) / 2,
        }))
      : findEyes(full);

    const openBuffer = encodePng(full);
    const thumbBuffer = encodePng(thumb);
    fs.writeFileSync(path.join(OUT_DIR, `${assetId}.png`), openBuffer);
    fs.writeFileSync(path.join(OUT_DIR, `${assetId}-thumb.png`), thumbBuffer);
    outputBytes += openBuffer.length + thumbBuffer.length;

    // 눈을 찾았을 때만 깜빡임 프레임을 만듭니다.
    let blinkRef = "";
    if (eyes) {
      const blinkBuffer = encodePng(makeBlinkFrame(full, eyes));
      fs.writeFileSync(path.join(OUT_DIR, `${assetId}-blink.png`), blinkBuffer);
      outputBytes += blinkBuffer.length;
      blinkRef = `/assets/ggumdori/${assetId}-blink.png`;
    } else {
      needsReview.push(assetId);
    }

    entries.push({
      assetId,
      // 앱이 그대로 쓰는 경로입니다. 클라이언트가 경로를 계산하지 않습니다. (명세 §5.1)
      stillImageRef: `/assets/ggumdori/${assetId}.png`,
      blinkImageRef: blinkRef,
      thumbImageRef: `/assets/ggumdori/${assetId}-thumb.png`,
      width: full.width,
      height: full.height,
      // 눈 좌표를 남겨 두면 손으로 고칠 때 출발점이 됩니다.
      eyes: eyes ? eyes.map((e) => [e.minX, e.minY, e.maxX, e.maxY]) : null,
      eyesSource: override ? "override" : eyes ? "auto" : "none",
      sourceFile: file,
    });

    console.log(
      `  ${assetId.padEnd(16)} ${String((sourceBuffer.length / 1024).toFixed(0)).padStart(5)}KB → ` +
        `${String((openBuffer.length / 1024).toFixed(1)).padStart(6)}KB  눈=${eyes ? (override ? "수동" : "자동") : "실패"}`,
    );
  }

  // 매니페스트를 씁니다. DB 시딩이 이 파일 하나만 읽습니다.
  const manifest = {
    generatedAt: new Date().toISOString(),
    fullSize: FULL_SIZE,
    thumbSize: THUMB_SIZE,
    entries,
  };
  fs.writeFileSync(path.join(OUT_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`\n${entries.length}개 처리. ${(sourceBytes / 1024 / 1024).toFixed(1)}MB → ${(outputBytes / 1024 / 1024).toFixed(2)}MB`);
  console.log(`매니페스트: ${path.relative(ROOT, path.join(OUT_DIR, "manifest.json"))}`);

  if (needsReview.length > 0) {
    console.log(`\n눈을 못 찾은 에셋 ${needsReview.length}개: ${needsReview.join(", ")}`);
    console.log(`좌표를 ${path.relative(ROOT, OVERRIDE_FILE)} 에 적으면 다음 실행부터 반영됩니다.`);
    console.log(`  형식: { "asset-id": [[눈1 minX, minY, maxX, maxY], [눈2 ...]] }`);
  }
}

main();
