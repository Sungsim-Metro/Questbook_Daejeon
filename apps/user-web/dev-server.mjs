// 백엔드 없이 user-web 을 브라우저에서 확인하기 위한 개발 전용 정적 서버입니다.
// infra/nginx/questbook-baseline.conf 와 같은 경로 매핑을 씁니다.
//   root      -> apps/user-web/public
//   /src/     -> apps/user-web/src/
//   /assets/  -> apps/user-web/public/assets/
//
// 실행:  node apps/user-web/dev-server.mjs
//        ACCOUNT_TYPE=social node apps/user-web/dev-server.mjs   (소셜 계정 화면 확인)
//        WEATHER=none|fail    node apps/user-web/dev-server.mjs   (예보 미제공·실패 확인)
//
// 여기의 목 응답은 화면 확인용입니다. 실제 계약은 services/ 의 API 가 정본입니다.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 이 파일이 있는 apps/user-web 디렉터리입니다. 어느 위치에서 실행해도 동작합니다.
const APP = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(APP, "public");
const SRC_DIR = path.join(APP, "src");
const PORT = Number(process.env.PORT || 4173);

// 계정 흐름 확인용 목 사용자입니다. ACCOUNT_TYPE 로 게스트/소셜을 바꿔 실행합니다.
const MOCK = {
  nickname: "대전 탐험가",
  accountType: process.env.ACCOUNT_TYPE || "guest",
  email: process.env.ACCOUNT_TYPE === "social" ? "explorer@example.com" : "",
  provider: process.env.ACCOUNT_TYPE === "social" ? "naver" : "",
};

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
};

function resolveFile(urlPath) {
  // 쿼리스트링을 떼어낸 경로입니다.
  const clean = decodeURIComponent(urlPath.split("?")[0]);

  if (clean.startsWith("/src/")) {
    return path.join(SRC_DIR, clean.slice("/src/".length));
  }
  if (clean === "/" || clean === "") {
    return path.join(PUBLIC_DIR, "index.html");
  }
  return path.join(PUBLIC_DIR, clean);
}

http
  .createServer((req, res) => {
    // 계정 흐름만 확인할 수 있게 최소한의 목 API 를 둡니다. 나머지는 503 으로 폴백시킵니다.
    if (req.url.startsWith("/api/")) {
      const apiPath = req.url.split("?")[0];
      const json = (code, body) => {
        res.writeHead(code, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (apiPath === "/api/auth/demo-login") return json(200, { accessToken: "guest-token-abc" });
      if (apiPath === "/api/me" && req.method === "GET")
        return json(200, {
          nickname: MOCK.nickname,
          accountType: MOCK.accountType,
          email: MOCK.email,
          provider: MOCK.provider,
          currentLevel: 3,
          xp: 1240,
          nextLevelXp: 1800,
        });
      if (apiPath === "/api/me/nickname") {
        let raw = "";
        req.on("data", (d) => (raw += d));
        req.on("end", () => {
          try { MOCK.nickname = JSON.parse(raw).nickname || MOCK.nickname; } catch {}
          json(200, { ok: true, nickname: MOCK.nickname });
        });
        return;
      }
      // 날씨 목업입니다. WEATHER=none 이면 예보 미제공, WEATHER=fail 이면 실패를 흉내냅니다.
      if (apiPath === "/api/weather") {
        if (process.env.WEATHER === "fail") return json(500, { ok: false });
        if (process.env.WEATHER === "none") return json(200, { outOfRange: true });
        return json(200, {
          temperatureC: 21.4,
          precipitationProbability: 20,
          condition: "구름 조금",
          outdoorNote: "오후에 바람이 조금 불어요. 겉옷을 챙기면 좋아요.",
          hourly: [
            { time: "09시", temperatureC: 17, pop: 10 },
            { time: "12시", temperatureC: 21, pop: 20 },
            { time: "15시", temperatureC: 23, pop: 30 },
            { time: "18시", temperatureC: 20, pop: 40 },
            { time: "21시", temperatureC: 16, pop: 10 },
          ],
        });
      }
      // 위치 검색 목업입니다.
      if (apiPath === "/api/places/search") {
        const q = decodeURIComponent((req.url.split("query=")[1] || "").split("&")[0]);
        return json(200, {
          items: [
            { name: q + " 일대", roadAddress: "대전광역시 유성구 대덕대로 480", latitude: 36.3745, longitude: 127.3865 },
            { name: q + " 시장", roadAddress: "대전광역시 중구 대종로 480", latitude: 36.3283, longitude: 127.4275 },
          ],
        });
      }
      return json(503, { ok: false, error: "api-not-running" });
    }

    const file = resolveFile(req.url);

    fs.readFile(file, (error, data) => {
      if (error) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("not found: " + req.url);
        return;
      }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream" });
      res.end(data);
    });
  })
  .listen(PORT, () => console.log("serving user-web on http://localhost:" + PORT));
