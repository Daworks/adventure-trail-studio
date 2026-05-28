# Adventure Trail Studio

[한국어](./README.ko.md) | English

Desktop-first GPX route editor MVP based on `PRD.md`.

## Stack

- Frontend: Next.js App Router, React, TypeScript, Tailwind CSS, Zustand
- Map: SDK-neutral adapter factory in `src/map/index.ts`, currently backed by Kakao Maps SDK
- Geometry: Turf.js plus local distance helpers
- Backend: Rust, Axum, Tokio
- Storage: SQLite through `sqlx`

## Environment

Kakao Maps reads the browser key from `.env`.

```sh
KAKAO_API_KEY=...
```

`next.config.mjs` maps `KAKAO_API_KEY` to `NEXT_PUBLIC_KAKAO_MAP_API_KEY`. The Kakao developer console must allow the local web origin you use, for example `http://localhost:3000`.

Optional API settings:

```sh
TOURMAP_API_ADDR=127.0.0.1:4000
DATABASE_URL=sqlite://tourmap.db
TOURMAP_API_BASE_URL=http://127.0.0.1:4000
```

## Run Locally

Install frontend dependencies once:

```sh
npm install
```

Run the Rust API:

```sh
cd backend
cargo run
```

Run the Next.js editor in another terminal:

```sh
TOURMAP_API_BASE_URL=http://127.0.0.1:4000 npm run dev -- --port 3000
```

Open `http://localhost:3000`.

The frontend proxies `/api/*` through the App Router API proxy to `TOURMAP_API_BASE_URL` at runtime. If that variable is omitted, it defaults to `http://127.0.0.1:4000`. For production, pass the same variable to `npm run start`.

## Verify

Frontend:

```sh
npm run check:kakao
npm run test:frontend
npm run typecheck
npm run build
```

Kakao browser-origin check:

```sh
KAKAO_WEB_ORIGIN=http://localhost:3000 npm run check:kakao:origin
```

Browser smoke check while the backend and frontend dev servers are active:

```sh
npm run check:browser -- http://127.0.0.1:3000
```

The browser smoke check accepts either a real Kakao Maps runtime or the local fallback map. Passing with the fallback proves the editor shell and click/drag fallback are available, but it does not prove Kakao map tiles or Kakao geocoding for that origin.

If the origin check returns HTTP 401, or the browser smoke check reports `net::ERR_BLOCKED_BY_ORB` for the Kakao SDK script, Kakao is returning a non-JavaScript error response to the browser. Check the Kakao Developers app, JavaScript key, and allowed web platform domain for the exact local origin.

Backend:

```sh
cd backend
cargo check
cargo test
```

API smoke check while `cargo run` is active:

```sh
curl http://127.0.0.1:4000/health
```

Expected response:

```txt
ok
```

Export GPX XML from a project payload through the backend:

```sh
curl -X POST "http://127.0.0.1:4000/api/gpx/export?type=track" \
  -H "content-type: application/json" \
  --data @project.json
```

Parse GPX XML into route segments and waypoints through the backend:

```sh
curl -X POST "http://127.0.0.1:4000/api/gpx/import" \
  -H "content-type: application/json" \
  --data '{"xml":"<gpx><rte><name>루트</name><rtept lat=\"37.5\" lon=\"127\" /></rte></gpx>"}'
```

Create, update, or delete route segments independently through the route module:

```sh
curl -X POST "http://127.0.0.1:4000/api/projects/project-id/segments" \
  -H "content-type: application/json" \
  --data '{"id":"seg-new","name":"새 구간","points":[]}'
```

## Implemented MVP Features

- Korean desktop-first editor UI with left sidebar, map workspace, right properties panel, and bottom route status bar
- Kakao map drag/pan, standard/satellite modes, and address/place search
- In-app Kakao SDK loading status and failure message for API key/domain diagnostics
- Route drawing by map click with connected segments
- Route point drag movement, coordinate editing, insertion on segment click, deletion, segment deletion, and point-based segment splitting
- Undo/redo for editing operations with `Ctrl/Cmd+Z` and `Ctrl/Cmd+Shift+Z`
- GPX import by file picker or drag and drop
- GPX parsing for tracks, routes, and waypoints, including metadata names and invalid-coordinate filtering
- GPX track/route export with waypoint output
- Backend GPX import endpoint for GPX XML payloads and track/route export endpoint for project JSON payloads
- Backend route segment endpoints for listing, creating, updating, and deleting project route segments
- Local project save, reopen, and delete through Rust API and SQLite
- Project metadata display for title, created date, updated date, segment count, point count, waypoint count, and distance
- Waypoint creation and editing for Start, Finish, Fuel, Food, Camp, and Warning
- Large route rendering safeguards with Turf simplification, sampled point handles, and changed-object map rendering

## Current Notes

- GPX files are handled locally in the browser for import/export; the backend also exposes GPX import/export endpoints for API workflows.
- The route editor preserves original route points but may render simplified polylines for large routes; unchanged map objects are reused between editor updates.
- The Kakao Maps SDK is loaded at runtime, so a valid key and allowed local domain are required for real map tiles.
- If Kakao SDK loading fails, the editor shows a local fallback grid so route editing UI can still be smoke-tested while Kakao Developers origin settings are fixed.
- If `npm run check:kakao` returns HTTP 404, verify that `.env` contains a Kakao JavaScript key, not another Kakao product key.
- The original static preview remains in `index.html`, `styles.css`, and `src/*.js`; the Next.js app is the active MVP path.
