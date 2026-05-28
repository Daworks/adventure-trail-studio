# Adventure Trail Studio

한국어 | [English](./README.en.md)

Adventure Trail Studio는 GPX 기반 모터사이클 투어링 코스를 만들고 편집하기 위한 데스크톱 우선 웹 애플리케이션입니다.

## 주요 기능

- 카카오 지도 기반 코스 편집
- GPX 가져오기와 GPX 내보내기
- 로컬 프로젝트 저장과 다시 열기
- 경로 포인트 이동, 삽입, 삭제, 구간 분리, 구간 연결
- 웨이포인트 생성과 편집
- 위성/하이브리드 지도 보기와 주소 검색

## 기술 스택

- Frontend: Next.js App Router, React, TypeScript, Tailwind CSS, Zustand
- Map: `src/map/index.ts`의 SDK 중립 어댑터 팩토리, 현재 Kakao Maps SDK 사용
- Geometry: Turf.js와 로컬 거리 계산 헬퍼
- Backend: Rust, Axum, Tokio
- Storage: SQLite, `sqlx`

## 카카오 JavaScript 키 만들기

카카오 지도 JavaScript API를 사용하려면 카카오디벨로퍼스에서 앱을 만들고 JavaScript 키를 발급받아야 합니다.

1. [카카오디벨로퍼스](https://developers.kakao.com/)에 로그인합니다.
2. 상단 메뉴에서 **내 애플리케이션**으로 이동합니다.
3. **애플리케이션 추가하기**를 눌러 앱 이름과 사업자명을 입력하고 앱을 생성합니다.
4. 생성된 앱의 관리 화면에서 **앱 키** 또는 **플랫폼 키** 영역을 엽니다.
5. **JavaScript 키**를 복사합니다.
6. 앱 관리 화면의 **플랫폼 키 > JavaScript 키 > JavaScript SDK 도메인**에 로컬 개발 주소를 등록합니다.
   - 로컬 개발 기본값: `http://localhost:3000`
   - `http://127.0.0.1:3000`으로 접속할 경우에는 이 주소도 별도로 등록해야 합니다.
   - Tauri 데스크톱 앱 기본값: `http://localhost:1420`
7. 프로젝트 루트의 `.env` 파일에 JavaScript 키를 저장합니다.

```sh
KAKAO_API_KEY=복사한_JavaScript_키
```

이 프로젝트의 `next.config.mjs`는 `KAKAO_API_KEY`를 브라우저에서 사용할 `NEXT_PUBLIC_KAKAO_MAP_API_KEY`로 전달합니다.

참고:

- 카카오 지도 Web API 가이드는 지도 API의 `appkey`로 JavaScript 키를 사용한다고 안내합니다: <https://apis.map.kakao.com/web/guide/>
- 카카오 JavaScript SDK 문서는 JavaScript SDK 도메인을 앱 관리 화면의 **플랫폼 키 > JavaScript 키 > JavaScript SDK 도메인**에 등록해야 한다고 안내합니다: <https://developers.kakao.com/docs/ko/javascript/getting-started>
- 카카오 앱 설정 문서는 JavaScript 키가 등록된 JavaScript SDK 도메인에서만 사용 가능하다고 설명합니다: <https://developers.kakao.com/docs/latest/ko/app-setting/app>

## 환경 변수

카카오 지도는 `.env`의 브라우저 키를 읽습니다.

```sh
KAKAO_API_KEY=...
```

`next.config.mjs`는 `KAKAO_API_KEY`를 `NEXT_PUBLIC_KAKAO_MAP_API_KEY`로 매핑합니다. 카카오 개발자 콘솔에는 실제로 접속하는 로컬 웹 출처를 등록해야 합니다. 예를 들어 웹 개발 서버는 `http://localhost:3000`, Tauri 데스크톱 앱은 `http://localhost:1420`입니다.

선택 API 설정:

```sh
TOURMAP_API_ADDR=127.0.0.1:4000
DATABASE_URL=sqlite://tourmap.db
TOURMAP_API_BASE_URL=http://127.0.0.1:4000
```

## 선행 설치

로컬에서 앱을 실행하려면 다음 프로그램이 필요합니다.

- Git: 원격 저장소를 내려받고 버전을 관리합니다.
- Node.js 22 LTS 이상과 npm: Next.js 프론트엔드를 실행합니다.
- Rust toolchain: Axum 백엔드 API를 빌드하고 실행합니다.
- 최신 데스크톱 브라우저: Chrome, Edge, Safari, Firefox 중 하나를 사용합니다.
- 카카오 JavaScript 키: 실제 카카오 지도 타일과 주소 검색을 사용하려면 필요합니다.

macOS에서 Homebrew를 사용한다면 다음 명령으로 Git, Node.js, Rust 설치 도구를 설치할 수 있습니다.

```sh
brew install git node rustup-init
rustup-init
```

Windows에서는 winget과 rustup을 사용할 수 있습니다.

```powershell
winget install --id Git.Git
winget install --id OpenJS.NodeJS.LTS
winget install --id Rustlang.Rustup
```

Linux Ubuntu/Debian 계열에서는 apt, NodeSource, rustup을 사용할 수 있습니다.

```sh
sudo apt update
sudo apt install -y git curl build-essential ca-certificates
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

설치 후 새 터미널을 열고 다음 명령으로 설치 상태를 확인합니다.

```sh
git --version
node --version
npm --version
rustc --version
cargo --version
```

SQLite는 백엔드가 `sqlx`의 SQLite 드라이버로 사용하므로 일반적인 로컬 실행에서는 별도 프로그램 설치가 필요하지 않습니다. 다만 데이터베이스 파일을 직접 열어보고 싶다면 `sqlite3` CLI를 추가로 설치해도 됩니다.

## 로컬 실행

### 스크립트로 한 번에 실행

macOS 또는 Linux 계열 셸에서는 프로젝트 루트에서 `run.sh`를 실행하면 Rust API 서버와 Next.js 개발 서버를 함께 시작할 수 있습니다.

```sh
./run.sh
```

Windows PowerShell에서는 `run.ps1`을 실행합니다.

```powershell
.\run.ps1
```

스크립트는 개발 서버가 응답하면 기본 브라우저로 웹 앱을 자동으로 엽니다.

기본 실행 주소:

- 웹 앱: `http://localhost:3000`
- API 서버: `http://127.0.0.1:4000`

종료하려면 실행 중인 터미널에서 `Ctrl+C`를 누릅니다. 포트나 API 주소를 바꾸고 싶다면 환경 변수를 함께 지정합니다.

```sh
PORT=3001 TOURMAP_API_ADDR=127.0.0.1:4100 ./run.sh
```

```powershell
$env:PORT="3001"; $env:TOURMAP_API_ADDR="127.0.0.1:4100"; .\run.ps1
```

`run.sh`와 `run.ps1`은 `node_modules`가 없으면 `npm install`을 먼저 실행합니다. 카카오맵을 사용하려면 프로젝트 루트의 `.env`에 `KAKAO_API_KEY`가 있어야 합니다.

### 수동 실행

프론트엔드 의존성을 설치합니다.

```sh
npm install
```

Rust API 서버를 실행합니다.

```sh
cd backend
cargo run
```

다른 터미널에서 Next.js 개발 서버를 실행합니다.

```sh
TOURMAP_API_BASE_URL=http://127.0.0.1:4000 npm run dev -- --port 3000
```

브라우저에서 `http://localhost:3000`을 엽니다.

프론트엔드는 App Router API 프록시를 통해 런타임에 `/api/*` 요청을 `TOURMAP_API_BASE_URL`로 전달합니다. 이 변수가 없으면 기본값은 `http://127.0.0.1:4000`입니다. 프로덕션 실행 시에도 같은 변수를 `npm run start`에 전달합니다.

## 프로덕션 서버 배포

권장 배포 방식은 기존 Laravel 사이트와 분리된 서브도메인에서 실행하는 것입니다. 예를 들어 `https://ats.civa.kr`는 Adventure Trail Studio 전용 Nginx server block으로 구성하고, 기존 `https://civa.kr` Laravel 사이트에는 메뉴 링크만 추가합니다.

현재 기준 배포 경로와 포트:

- 배포 루트: `/var/www/civa.kr/ats.civa.kr`
- 현재 릴리즈 링크: `/var/www/civa.kr/ats.civa.kr/current`
- 공유 데이터: `/var/www/civa.kr/ats.civa.kr/shared`
- Next.js 앱: `127.0.0.1:3100`
- Rust API: `127.0.0.1:4100`
- 웹 서비스: `ats-web.service`
- API 서비스: `ats-api.service`

서버에서 빌드하지 않고 로컬에서 빌드한 산출물만 배포합니다. macOS에서 Ubuntu 서버용 Rust 바이너리를 만들려면 Docker의 Linux/amd64 컨테이너를 사용합니다.

```sh
npm run build

docker run --rm --platform linux/amd64 \
  -v "$PWD/backend:/app" \
  -w /app \
  rust:1.93-bookworm \
  cargo build --release
```

배포 압축 파일을 만듭니다.

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

서버로 업로드합니다.

```sh
scp /private/tmp/adventure-trail-studio-release.tgz onlinejubo.com:/tmp/adventure-trail-studio-release.tgz
```

서버에서는 새 릴리즈 디렉터리에 압축을 풀고 `current` 심볼릭 링크를 교체합니다. 운영 환경 파일은 공유 디렉터리에 둡니다.

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

환경 파일 예시:

```sh
sudo tee /var/www/civa.kr/ats.civa.kr/shared/ats.env >/dev/null <<'EOF'
NODE_ENV=production
PORT=3100
HOSTNAME=127.0.0.1
TOURMAP_API_BASE_URL=http://127.0.0.1:4100
TOURMAP_API_ADDR=127.0.0.1:4100
DATABASE_URL=sqlite:///var/www/civa.kr/ats.civa.kr/shared/data/tourmap.db
NEXT_PUBLIC_KAKAO_MAP_API_KEY=카카오_JavaScript_키
EOF
sudo chown civa:civa /var/www/civa.kr/ats.civa.kr/shared/ats.env
sudo chmod 600 /var/www/civa.kr/ats.civa.kr/shared/ats.env
```

systemd 서비스는 각각 Next.js와 Rust API를 실행합니다.

```ini
# /etc/systemd/system/ats-api.service
[Unit]
Description=Adventure Trail Studio API
After=network.target

[Service]
User=civa
Group=civa
WorkingDirectory=/var/www/civa.kr/ats.civa.kr/current
EnvironmentFile=/var/www/civa.kr/ats.civa.kr/shared/ats.env
ExecStart=/var/www/civa.kr/ats.civa.kr/current/backend/target/release/tourmap-api
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```ini
# /etc/systemd/system/ats-web.service
[Unit]
Description=Adventure Trail Studio Web
After=network.target ats-api.service
Requires=ats-api.service

[Service]
User=civa
Group=civa
WorkingDirectory=/var/www/civa.kr/ats.civa.kr/current
EnvironmentFile=/var/www/civa.kr/ats.civa.kr/shared/ats.env
ExecStart=/usr/bin/node /var/www/civa.kr/ats.civa.kr/current/node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3100
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Nginx는 `ats.civa.kr` 전용 server block만 추가합니다. 기존 `civa.kr` Laravel 설정은 수정하지 않습니다.

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

서비스와 Nginx를 적용합니다.

```sh
sudo systemctl daemon-reload
sudo systemctl enable ats-api.service ats-web.service
sudo systemctl restart ats-api.service ats-web.service
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d ats.civa.kr --redirect
```

배포 후 확인:

```sh
systemctl is-active ats-api.service ats-web.service nginx
curl http://127.0.0.1:4100/health
curl https://ats.civa.kr/api/projects
```

카카오 개발자 콘솔의 JavaScript SDK 도메인에는 실제 운영 Origin을 추가해야 합니다.

```txt
https://ats.civa.kr
```

## Tauri 데스크톱 앱 빌드

Tauri 빌드는 Next.js 프론트엔드를 정적 파일로 export하고, Rust Axum API를 sidecar 실행 파일로 묶어 데스크톱 앱 안에서 함께 실행합니다.

데스크톱 앱은 카카오맵 JavaScript SDK 도메인 검증을 통과할 수 있도록 Tauri 기본 custom protocol 대신 로컬 HTTP origin을 사용합니다.

```txt
http://localhost:1420
```

카카오맵이 데스크톱 앱에서 로딩되지 않으면 카카오디벨로퍼스의 **플랫폼 키 > JavaScript 키 > JavaScript SDK 도메인**에 위 주소가 등록되어 있는지 확인하세요.

추가로 필요한 도구:

- macOS 빌드: Xcode Command Line Tools
- Windows 빌드: Microsoft Visual Studio Build Tools와 WebView2 Runtime

로컬에서 현재 OS용 sidecar를 준비합니다.

```sh
npm run prepare:tauri-sidecar
```

데스크톱용 정적 프론트엔드를 빌드합니다.

```sh
KAKAO_API_KEY=카카오_JavaScript_키 npm run build:desktop
```

현재 OS용 Tauri 앱 번들을 생성합니다.

```sh
KAKAO_API_KEY=카카오_JavaScript_키 npm run tauri build
```

macOS에서 성공하면 보통 다음 파일이 생성됩니다.

```txt
src-tauri/target/release/bundle/macos/Adventure Trail Studio.app
src-tauri/target/release/bundle/dmg/Adventure Trail Studio_버전_aarch64.dmg
```

Windows에서 성공하면 보통 다음 파일이 생성됩니다.

```txt
src-tauri/target/release/bundle/nsis/Adventure Trail Studio_버전_x64-setup.exe
```

macOS 샘플 릴리즈는 ad-hoc signing으로 서명됩니다. Apple Developer ID 인증서와 notarization을 적용하지 않은 빌드는 다운로드 후 Gatekeeper 경고가 남을 수 있습니다. 테스트 목적으로 앱을 직접 실행하려면 `/Applications`에 앱을 복사한 뒤 quarantine 속성을 제거합니다.

```sh
xattr -dr com.apple.quarantine "/Applications/Adventure Trail Studio.app"
```

공식 배포용 DMG를 만들려면 Apple Developer ID 인증서, notarization용 Apple 계정 정보, Tauri macOS signing/notarization 설정이 추가로 필요합니다.

GitHub Actions에서 릴리즈 빌드를 만들려면 저장소 Secret에 `KAKAO_API_KEY`를 등록한 뒤 `v*` 형식의 태그를 푸시합니다.

```sh
git tag v0.1.1
git push origin v0.1.1
```

릴리즈 워크플로는 macOS Apple Silicon용 DMG와 Windows x64 설치 파일을 GitHub Release에 업로드합니다.

## 검증

프론트엔드:

```sh
npm run check:kakao
npm run test:frontend
npm run typecheck
npm run build
```

카카오 브라우저 출처 검사:

```sh
KAKAO_WEB_ORIGIN=http://localhost:3000 npm run check:kakao:origin
```

백엔드와 프론트엔드 개발 서버가 켜져 있을 때 브라우저 스모크 테스트:

```sh
npm run check:browser -- http://127.0.0.1:3000
```

브라우저 스모크 테스트는 실제 Kakao Maps 런타임 또는 로컬 폴백 지도 중 하나로 통과할 수 있습니다. 폴백으로 통과하면 에디터 셸과 클릭/드래그 폴백은 검증되지만, 카카오 지도 타일이나 해당 출처의 카카오 지오코딩이 검증된 것은 아닙니다.

출처 검사에서 HTTP 401이 반환되거나 브라우저 스모크 테스트에서 Kakao SDK 스크립트에 `net::ERR_BLOCKED_BY_ORB`가 표시되면, 카카오가 브라우저에 JavaScript가 아닌 오류 응답을 반환하고 있는 상태입니다. 카카오디벨로퍼스 앱, JavaScript 키, 허용된 웹 플랫폼 도메인이 정확한 로컬 출처와 일치하는지 확인하세요.

백엔드:

```sh
cd backend
cargo check
cargo test
```

`cargo run`이 실행 중일 때 API 상태 확인:

```sh
curl http://127.0.0.1:4000/health
```

예상 응답:

```txt
ok
```

프로젝트 payload에서 GPX XML 내보내기:

```sh
curl -X POST "http://127.0.0.1:4000/api/gpx/export?type=track" \
  -H "content-type: application/json" \
  --data @project.json
```

GPX XML을 경로 구간과 웨이포인트로 가져오기:

```sh
curl -X POST "http://127.0.0.1:4000/api/gpx/import" \
  -H "content-type: application/json" \
  --data '{"xml":"<gpx><rte><name>루트</name><rtept lat=\"37.5\" lon=\"127\" /></rte></gpx>"}'
```

route module을 통해 경로 구간을 독립적으로 생성, 수정, 삭제:

```sh
curl -X POST "http://127.0.0.1:4000/api/projects/project-id/segments" \
  -H "content-type: application/json" \
  --data '{"id":"seg-new","name":"새 구간","points":[]}'
```

## 구현된 MVP 기능

- 왼쪽 사이드바, 지도 작업 영역, 오른쪽 속성 패널, 하단 경로 상태 바를 가진 한국어 데스크톱 우선 에디터 UI
- 카카오 지도 드래그/패닝, 일반/위성 모드, 주소/장소 검색
- API 키와 도메인 진단을 위한 앱 내 Kakao SDK 로딩 상태와 실패 메시지
- 지도 클릭 기반 경로 그리기와 연결된 구간 표시
- 경로 포인트 드래그 이동, 좌표 편집, 구간 클릭 삽입, 삭제, 구간 삭제, 포인트 기반 구간 분리
- `Ctrl/Cmd+Z`와 `Ctrl/Cmd+Shift+Z`를 통한 편집 작업 undo/redo
- 파일 선택 또는 드래그 앤 드롭 GPX 가져오기
- 메타데이터 이름과 잘못된 좌표 필터링을 포함한 track, route, waypoint GPX 파싱
- 웨이포인트 포함 GPX 내보내기
- GPX XML payload를 위한 백엔드 GPX 가져오기 endpoint와 project JSON payload를 위한 track 내보내기 endpoint
- 프로젝트 경로 구간 조회, 생성, 수정, 삭제를 위한 백엔드 route segment endpoint
- Rust API와 SQLite를 통한 로컬 프로젝트 저장, 다시 열기, 삭제
- 제목, 생성일, 수정일, 구간 수, 포인트 수, 웨이포인트 수, 거리 프로젝트 메타데이터 표시
- Start, Finish, Fuel, Food, Camp, Warning 웨이포인트 생성과 편집
- Turf simplification, 샘플링된 포인트 핸들, 변경된 객체 중심 지도 렌더링을 통한 대형 경로 렌더링 보호

## 현재 참고 사항

- GPX 파일은 가져오기/내보내기 시 브라우저에서 로컬로 처리됩니다. 백엔드도 API 워크플로를 위한 GPX 가져오기/내보내기 endpoint를 제공합니다.
- 경로 에디터는 원본 경로 포인트를 보존하지만, 큰 경로는 단순화된 폴리라인으로 렌더링할 수 있습니다. 변경되지 않은 지도 객체는 에디터 업데이트 사이에 재사용됩니다.
- Kakao Maps SDK는 런타임에 로드되므로 실제 지도 타일을 보려면 유효한 키와 허용된 로컬 도메인이 필요합니다.
- Kakao SDK 로딩에 실패하면 에디터는 로컬 폴백 그리드를 표시하므로 카카오디벨로퍼스 출처 설정을 수정하는 동안에도 경로 편집 UI를 스모크 테스트할 수 있습니다.
- `npm run check:kakao`가 HTTP 404를 반환하면 `.env`에 다른 카카오 제품 키가 아닌 Kakao JavaScript 키가 들어 있는지 확인하세요.
- 기존 정적 프리뷰는 `index.html`, `styles.css`, `src/*.js`에 남아 있습니다. 현재 활성 MVP 경로는 Next.js 앱입니다.
