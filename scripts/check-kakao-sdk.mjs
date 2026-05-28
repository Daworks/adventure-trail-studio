import { readFileSync } from "node:fs";

const env = loadEnvFile(".env");
const appKey = process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY || process.env.KAKAO_API_KEY || env.NEXT_PUBLIC_KAKAO_MAP_API_KEY || env.KAKAO_API_KEY;
const origin = process.env.KAKAO_WEB_ORIGIN || "http://localhost:3000";
const checkOrigin = process.argv.includes("--origin");

if (!appKey) {
  console.error("Kakao Maps key is missing. Set KAKAO_API_KEY or NEXT_PUBLIC_KAKAO_MAP_API_KEY.");
  process.exit(1);
}

const url = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(appKey)}&autoload=false&libraries=services`;

try {
  const response = await fetch(url, {
    method: "GET",
    headers: checkOrigin ? { Referer: `${origin.replace(/\/$/, "")}/` } : undefined,
  });
  if (!response.ok) {
    console.error(
      checkOrigin
        ? `Kakao Maps SDK origin check failed with HTTP ${response.status} for ${origin}.`
        : `Kakao Maps SDK check failed with HTTP ${response.status}.`,
    );
    console.error(
      checkOrigin
        ? "Verify that this exact origin is registered as a Kakao Developers web platform domain."
        : "Verify that the key is a Kakao JavaScript key.",
    );
    process.exit(1);
  }
  const body = await response.text();
  if (!body.includes("kakao")) {
    console.error("Kakao Maps SDK response did not look like a valid SDK script.");
    process.exit(1);
  }
  console.log(checkOrigin ? `Kakao Maps SDK origin check passed for ${origin}.` : "Kakao Maps SDK check passed.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Kakao Maps SDK check failed.");
  process.exit(1);
}

function loadEnvFile(path) {
  try {
    return Object.fromEntries(
      readFileSync(path, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => {
          const index = line.indexOf("=");
          return [line.slice(0, index).trim(), line.slice(index + 1).trim().replace(/^["']|["']$/g, "")];
        }),
    );
  } catch {
    return {};
  }
}
