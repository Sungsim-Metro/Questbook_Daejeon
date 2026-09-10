// 의존성 없이 PNG 를 읽고 쓰는 최소 구현입니다.
// 저장소에 package.json 이 없으므로 Node 내장 zlib 만 씁니다.
// 8비트 RGB/RGBA 만 다룹니다. 그 밖의 형식은 명시적으로 거절합니다.
import zlib from "node:zlib";

// PNG 파일 시그니처입니다.
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// CRC 계산용 표입니다. 최초 1회만 만듭니다.
let crcTable = null;

/**
 * 입력: 없음.
 * 출력: CRC32 조회표.
 * 역할: 청크 검증값 계산을 빠르게 한다.
 * 호출 예시: const table = getCrcTable()
 */
function getCrcTable() {
  if (crcTable) {
    return crcTable;
  }

  crcTable = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    // 이 바이트 값의 누적 CRC 입니다.
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[n] = c;
  }
  return crcTable;
}

/**
 * 입력: 버퍼.
 * 출력: CRC32 값.
 * 역할: PNG 청크의 검증값을 만든다.
 * 호출 예시: crc32(Buffer.concat([type, data]))
 */
function crc32(buffer) {
  // 조회표입니다.
  const table = getCrcTable();
  // 누적 CRC 입니다.
  let c = -1;

  for (let i = 0; i < buffer.length; i++) {
    c = table[(c ^ buffer[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ -1) >>> 0;
}

/**
 * 입력: 이전 픽셀들과 필터 종류.
 * 출력: 없음. 스캔라인을 제자리에서 복원한다.
 * 역할: PNG 의 다섯 가지 행 필터를 되돌린다.
 * 호출 예시: unfilter(line, prev, bpp, filterType)
 */
function unfilter(line, prev, bpp, filterType) {
  for (let i = 0; i < line.length; i++) {
    // 왼쪽 픽셀 값입니다.
    const a = i >= bpp ? line[i - bpp] : 0;
    // 바로 위 픽셀 값입니다.
    const b = prev ? prev[i] : 0;
    // 왼쪽 위 대각선 픽셀 값입니다.
    const c = prev && i >= bpp ? prev[i - bpp] : 0;

    if (filterType === 1) {
      line[i] = (line[i] + a) & 0xff;
    } else if (filterType === 2) {
      line[i] = (line[i] + b) & 0xff;
    } else if (filterType === 3) {
      line[i] = (line[i] + ((a + b) >> 1)) & 0xff;
    } else if (filterType === 4) {
      // Paeth 예측기입니다.
      const p = a + b - c;
      const pa = Math.abs(p - a);
      const pb = Math.abs(p - b);
      const pc = Math.abs(p - c);
      const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      line[i] = (line[i] + pred) & 0xff;
    }
  }
}

/**
 * 입력: PNG 파일 버퍼.
 * 출력: { width, height, data } 형태의 RGBA 이미지.
 * 역할: 8비트 RGB/RGBA PNG 를 RGBA 바이트 배열로 푼다.
 * 호출 예시: const img = decodePng(fs.readFileSync("a.png"))
 */
export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error("PNG 시그니처가 아닙니다.");
  }

  // 이미지 머리 정보입니다.
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  // 압축된 픽셀 데이터 조각들입니다.
  const idat = [];

  // 현재 읽는 위치입니다.
  let offset = 8;
  while (offset < buffer.length) {
    // 이 청크의 데이터 길이입니다.
    const length = buffer.readUInt32BE(offset);
    // 청크 종류 문자열입니다.
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    // 청크 데이터입니다.
    const data = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colorType = data[9];
      if (data[12] !== 0) {
        throw new Error("인터레이스 PNG 는 지원하지 않습니다.");
      }
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }

    offset += 12 + length;
  }

  if (depth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`8비트 RGB/RGBA 만 지원합니다. (depth=${depth}, colorType=${colorType})`);
  }

  // 픽셀당 바이트 수입니다.
  const bpp = colorType === 6 ? 4 : 3;
  // 압축을 푼 원본 바이트입니다.
  const raw = zlib.inflateSync(Buffer.concat(idat));
  // 한 줄의 바이트 수입니다.
  const stride = width * bpp;
  // 결과 RGBA 버퍼입니다.
  const out = Buffer.alloc(width * height * 4);

  // 직전 줄입니다. Paeth 등에 씁니다.
  let prev = null;
  for (let y = 0; y < height; y++) {
    // 이 줄의 필터 종류입니다.
    const filterType = raw[y * (stride + 1)];
    // 이 줄의 픽셀 바이트입니다.
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride));

    unfilter(line, prev, bpp, filterType);

    for (let x = 0; x < width; x++) {
      const di = (y * width + x) * 4;
      out[di] = line[x * bpp];
      out[di + 1] = line[x * bpp + 1];
      out[di + 2] = line[x * bpp + 2];
      out[di + 3] = colorType === 6 ? line[x * bpp + 3] : 255;
    }

    prev = line;
  }

  return { width, height, data: out };
}

/**
 * 입력: 청크 종류와 데이터.
 * 출력: 길이·종류·데이터·CRC 로 이루어진 청크 버퍼.
 * 역할: PNG 청크 하나를 만든다.
 * 호출 예시: makeChunk("IHDR", header)
 */
function makeChunk(type, data) {
  // 길이 필드입니다.
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  // 종류와 데이터를 이어 붙인 검증 대상입니다.
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);

  // 검증값 필드입니다.
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);

  return Buffer.concat([length, body, crc]);
}

/**
 * 입력: { width, height, data } 형태의 RGBA 이미지.
 * 출력: PNG 파일 버퍼.
 * 역할: RGBA 이미지를 8비트 RGBA PNG 로 쓴다.
 * 호출 예시: fs.writeFileSync("a.png", encodePng(img))
 */
export function encodePng(image) {
  const { width, height, data } = image;

  // 필터 바이트를 포함한 원본 바이트입니다. 필터는 쓰지 않습니다(0).
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    data.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }

  // IHDR 데이터입니다.
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;

  return Buffer.concat([
    SIGNATURE,
    makeChunk("IHDR", header),
    makeChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    makeChunk("IEND", Buffer.alloc(0)),
  ]);
}

/**
 * 입력: 너비와 높이.
 * 출력: 완전히 투명한 RGBA 이미지.
 * 역할: 새 캔버스를 만든다.
 * 호출 예시: createImage(128, 128)
 */
export function createImage(width, height) {
  return { width, height, data: Buffer.alloc(width * height * 4) };
}

/**
 * 입력: 이미지와 좌표.
 * 출력: [r, g, b, a] 배열.
 * 역할: 픽셀 하나를 읽는다.
 * 호출 예시: getPixel(img, 10, 20)
 */
export function getPixel(image, x, y) {
  const i = (y * image.width + x) * 4;
  return [image.data[i], image.data[i + 1], image.data[i + 2], image.data[i + 3]];
}

/**
 * 입력: 이미지, 좌표, 색.
 * 출력: 없음.
 * 역할: 픽셀 하나를 쓴다.
 * 호출 예시: setPixel(img, 10, 20, [255, 0, 0, 255])
 */
export function setPixel(image, x, y, [r, g, b, a]) {
  const i = (y * image.width + x) * 4;
  image.data[i] = r;
  image.data[i + 1] = g;
  image.data[i + 2] = b;
  image.data[i + 3] = a;
}
