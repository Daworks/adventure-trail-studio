# Adventure Trail Studio

[한국어](./README.md) | English

Desktop-first GPX route editor MVP based on `PRD.md`.

## License

Adventure Trail Studio is distributed under a **source-available license for non-commercial use only**.

- Personal, educational, research, and non-profit use and modification are allowed.
- Commercial use, paid service operation, sale, or redistribution for commercial purposes requires separate permission.
- Contact Design Arete for a separate commercial license.

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

On macOS or Linux, start both the Rust API and Next.js dev server with:

```sh
./run.sh
```

On Windows PowerShell, use:

```powershell
.\run.ps1
```

Both scripts install `node_modules` when missing, start the API and web servers, then open the default browser when `http://localhost:3000` responds.

To override ports or API address:

```sh
PORT=3001 TOURMAP_API_ADDR=127.0.0.1:4100 ./run.sh
```

```powershell
$env:PORT="3001"; $env:TOURMAP_API_ADDR="127.0.0.1:4100"; .\run.ps1
```

Manual startup is also available. Install frontend dependencies once:

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

## Production Deployment

The recommended production setup is to run Adventure Trail Studio on a separate subdomain, for example `https://ats.civa.kr`, and add only a menu link from the existing Laravel site at `https://civa.kr`.

Current deployment conventions:

- App root: `/var/www/civa.kr/ats.civa.kr`
- Current release symlink: `/var/www/civa.kr/ats.civa.kr/current`
- Shared data: `/var/www/civa.kr/ats.civa.kr/shared`
- Next.js app: `127.0.0.1:3100`
- Rust API: `127.0.0.1:4100`
- Web service: `ats-web.service`
- API service: `ats-api.service`

Build locally and deploy artifacts to the Ubuntu server. Do not build on the production server. On macOS, use Docker to build the Linux x86_64 Rust API binary:

```sh
npm run build

docker run --rm --platform linux/amd64 \
  -v "$PWD/backend:/app" \
  -w /app \
  rust:1.93-bookworm \
  cargo build --release
```

Package the release:

```sh
tar --exclude='.git' \
  --exclude='node_modules' \
  --exclude='backend/target/debug' \
  --exclude='src-tauri/target' \
  --exclude='.next/cache' \
  -czf /private/tmp/adventure-trail-studio-release.tgz \
  package.json package-lock.json next.config.mjs app src styles.css \
  tailwind.config.ts postcss.config.mjs tsconfig.json next-env.d.ts \
  .next backend/target/release/tourmap-api
```

Upload it:

```sh
scp /private/tmp/adventure-trail-studio-release.tgz onlinejubo.com:/tmp/adventure-trail-studio-release.tgz
```

On the server, extract to a timestamped release directory and switch the `current` symlink:

```sh
APP_ROOT=/var/www/civa.kr/ats.civa.kr
RELEASE=$(date +%Y%m%d%H%M%S)
RELEASE_DIR=$APP_ROOT/releases/$RELEASE

sudo install -d -o civa -g civa "$APP_ROOT" "$APP_ROOT/releases" "$APP_ROOT/shared" "$APP_ROOT/shared/data" "$RELEASE_DIR"
sudo tar -xzf /tmp/adventure-trail-studio-release.tgz -C "$RELEASE_DIR"
sudo chown -R civa:civa "$RELEASE_DIR" "$APP_ROOT/shared"
sudo chmod +x "$RELEASE_DIR/backend/target/release/tourmap-api"
sudo npm --prefix "$RELEASE_DIR" ci --omit=dev
sudo ln -sfn "$RELEASE_DIR" "$APP_ROOT/current"
```

Runtime environment file:

```sh
sudo tee /var/www/civa.kr/ats.civa.kr/shared/ats.env >/dev/null <<'EOF'
NODE_ENV=production
PORT=3100
HOSTNAME=127.0.0.1
TOURMAP_API_BASE_URL=http://127.0.0.1:4100
TOURMAP_API_ADDR=127.0.0.1:4100
DATABASE_URL=sqlite:///var/www/civa.kr/ats.civa.kr/shared/data/tourmap.db
NEXT_PUBLIC_KAKAO_MAP_API_KEY=Kakao_JavaScript_key
EOF
sudo chown civa:civa /var/www/civa.kr/ats.civa.kr/shared/ats.env
sudo chmod 600 /var/www/civa.kr/ats.civa.kr/shared/ats.env
```

Create `ats-api.service` and `ats-web.service` with `User=civa`, then expose only Nginx publicly. The app processes should bind to `127.0.0.1`.

```nginx
server {
    listen 80;
    server_name ats.civa.kr;

    client_max_body_size 20M;

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_cache_bypass $http_upgrade;
    }
}
```

Apply and verify:

```sh
sudo systemctl daemon-reload
sudo systemctl enable ats-api.service ats-web.service
sudo systemctl restart ats-api.service ats-web.service
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d ats.civa.kr --redirect

systemctl is-active ats-api.service ats-web.service nginx
curl http://127.0.0.1:4100/health
curl https://ats.civa.kr/api/projects
```

Add the production origin to the Kakao Developers JavaScript SDK domain list:

```txt
https://ats.civa.kr
```

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
