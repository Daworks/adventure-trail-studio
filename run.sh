#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_ADDR="${TOURMAP_API_ADDR:-127.0.0.1:4000}"
API_BASE_URL="${TOURMAP_API_BASE_URL:-http://${API_ADDR}}"
WEB_PORT="${PORT:-3000}"
WEB_URL="http://localhost:${WEB_PORT}"

cd "$ROOT_DIR"

if [[ ! -f ".env" ]]; then
  cat <<'MSG'
.env 파일이 없습니다.
카카오맵을 사용하려면 프로젝트 루트에 다음 값을 추가하세요.

KAKAO_API_KEY=카카오_JavaScript_키
MSG
fi

if [[ ! -d "node_modules" ]]; then
  echo "node_modules가 없어 npm install을 실행합니다."
  npm install
fi

cleanup() {
  if [[ -n "${API_PID:-}" ]]; then
    kill "$API_PID" 2>/dev/null || true
  fi
  if [[ -n "${WEB_PID:-}" ]]; then
    kill "$WEB_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

echo "Rust API 서버를 시작합니다: ${API_ADDR}"
(
  cd "$ROOT_DIR/backend"
  TOURMAP_API_ADDR="$API_ADDR" cargo run
) &
API_PID=$!

echo "Next.js 개발 서버를 시작합니다: ${WEB_URL}"
TOURMAP_API_BASE_URL="$API_BASE_URL" npm run dev -- --port "$WEB_PORT" &
WEB_PID=$!

(
  for _ in {1..60}; do
    if curl -fsS "$WEB_URL" >/dev/null 2>&1; then
      if command -v open >/dev/null 2>&1; then
        open "$WEB_URL" >/dev/null 2>&1 || true
      elif command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$WEB_URL" >/dev/null 2>&1 || true
      fi
      exit 0
    fi
    sleep 1
  done
  echo "브라우저 자동 실행을 건너뜁니다. 서버 응답 확인 시간이 초과되었습니다."
) &

cat <<MSG

Adventure Trail Studio 로컬 서버가 시작되었습니다.

- 웹 앱: http://localhost:${WEB_PORT}
- API: ${API_BASE_URL}

종료하려면 Ctrl+C를 누르세요.
MSG

wait "$WEB_PID"
