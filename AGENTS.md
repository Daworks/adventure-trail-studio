# AGENTS.md

## Project

Adventure Trail Studio is a Next.js and Rust Axum GPX route editing web app.

The production app runs at:

- `https://ats.civa.kr`

The existing Laravel site at `https://civa.kr` should only link to the app. Do not merge this app into the Laravel public directory unless explicitly requested.

## Communication

- Respond to the user in Korean.
- Keep explanations concise and practical.
- Before making code edits, state what will be changed.
- If a command fails because of permissions, request approval instead of working around the sandbox.

## Local Development

- Main app directory: `/Users/dhlee/develope/mapStudio`
- Local web app: `http://localhost:3000`
- Local API: `http://127.0.0.1:4000`
- Start local servers with:

```sh
./run.sh
```

On Windows PowerShell:

```powershell
.\run.ps1
```

## Verification

For frontend or UI changes, run:

```sh
npm run typecheck
```

For production build verification, run:

```sh
npm run build
```

Only rebuild the Rust API when backend code or backend dependencies changed.

## Production Deployment

Production deployment uses local build artifacts. Do not build source code on the production server.

Server:

- SSH host: `onlinejubo.com`
- Deployment root: `/var/www/civa.kr/ats.civa.kr`
- Current symlink: `/var/www/civa.kr/ats.civa.kr/current`
- Shared data: `/var/www/civa.kr/ats.civa.kr/shared`
- Next.js service: `ats-web.service`
- Rust API service: `ats-api.service`
- Next.js internal address: `127.0.0.1:3100`
- Rust API internal address: `127.0.0.1:4100`

When the user asks to deploy:

1. Commit the current changes.
2. Push `main` to GitHub.
3. Run `npm run build`.
4. If only frontend, UI, docs, or static text changed, reuse the existing Linux Rust API binary.
5. If backend Rust code or backend dependencies changed, build the Ubuntu x86_64 API binary locally with Docker:

```sh
docker run --rm --platform linux/amd64 \
  -v /Users/dhlee/develope/mapStudio/backend:/app \
  -w /app \
  rust:1.93-bookworm \
  cargo build --release
```

6. Create `/private/tmp/adventure-trail-studio-release.tgz` from the built Next.js output and runtime files.
7. Upload the tarball to `onlinejubo.com:/tmp/adventure-trail-studio-release.tgz`.
8. Extract it into `/var/www/civa.kr/ats.civa.kr/releases/<timestamp>`.
9. Install production npm dependencies with `npm --prefix "$RELEASE_DIR" ci --omit=dev`.
10. Update `/var/www/civa.kr/ats.civa.kr/current`.
11. Restart services:

```sh
sudo systemctl restart ats-api.service ats-web.service
```

If only frontend code changed and the API binary was reused, restarting both services is acceptable, but restarting only `ats-web.service` is sufficient.

12. Validate:

```sh
systemctl is-active ats-api.service ats-web.service nginx
curl http://127.0.0.1:4100/health
curl -I https://ats.civa.kr/
curl https://ats.civa.kr/api/projects
```

## Kakao Maps

Kakao Maps requires a JavaScript key and allowed web origins in the Kakao Developers console.

Required production origin:

```txt
https://ats.civa.kr
```

Common local origins:

```txt
http://localhost:3000
http://127.0.0.1:3000
```

The app supports OpenStreetMap fallback when Kakao Maps is unavailable.

## Git

- Do not rewrite history unless explicitly requested.
- Do not revert user changes unless explicitly requested.
- Keep commits focused and descriptive.
- Use `git status --short` before final responses when files were edited.
