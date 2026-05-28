import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const url = process.argv[2] || "http://127.0.0.1:3000";
const chromePath =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const debugPort = Number(process.env.CHROME_DEBUG_PORT || 9223);
const userDataDir = await mkdtemp(join(tmpdir(), "tourmap-chrome-smoke-"));
const commandTimeoutMs = Number(process.env.SMOKE_COMMAND_TIMEOUT_MS || 10000);
const chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${userDataDir}`,
  "about:blank",
], {
  stdio: ["ignore", "ignore", "pipe"],
});
let exitCode = 0;
const chromeErrors = [];
chrome.stderr.setEncoding("utf8");
chrome.stderr.on("data", (chunk) => {
  chromeErrors.push(chunk);
});

let nextMessageId = 1;
const pending = new Map();

try {
  step("waiting for Chrome DevTools");
  await waitForDevTools(debugPort);
  const version = await fetchJson(`http://127.0.0.1:${debugPort}/json/version`);
  const socket = new WebSocket(version.webSocketDebuggerUrl);
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (!message.id) return;
    const callback = pending.get(message.id);
    if (!callback) return;
    pending.delete(message.id);
    if (message.error) {
      callback.reject(new Error(message.error.message));
    } else {
      callback.resolve(message.result);
    }
  });
  await once(socket, "open");

  const command = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = nextMessageId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, commandTimeoutMs);
      pending.set(id, {
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
      });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });

  step("creating browser target");
  const { targetId } = await command("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await command("Target.attachToTarget", { targetId, flatten: true });
  await command("Page.enable", {}, sessionId);
  await command("Runtime.enable", {}, sessionId);
  const consoleMessages = [];
  const networkMessages = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.method !== "Runtime.consoleAPICalled") return;
    const args = message.params?.args || [];
    consoleMessages.push(args.map((arg) => arg.value || arg.description || "").join(" "));
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    if (message.method === "Network.responseReceived") {
      const response = message.params?.response;
      if (response?.url?.includes("dapi.kakao.com")) {
        networkMessages.push(`${response.status} ${redactUrl(response.url)}`);
      }
    }
    if (message.method === "Network.loadingFailed") {
      const url = message.params?.requestId || "unknown request";
      networkMessages.push(`failed ${url}: ${message.params?.errorText || "unknown error"}`);
    }
  });
  await command("Network.enable", {}, sessionId);
  step(`navigating to ${url}`);
  await command("Page.navigate", { url }, sessionId);
  step("waiting for editor");
  await waitForEditorReady(command, sessionId);

  step("checking initial UI");
  const result = await command(
    "Runtime.evaluate",
    {
      awaitPromise: true,
      returnByValue: true,
      expression: `(() => {
        const text = document.body.innerText;
        const searchInput = document.querySelector('input[placeholder="주소 또는 장소 검색"]');
        const mapCanvas = document.querySelector('section.relative div.absolute.inset-0');
        const hasKakaoMaps = Boolean(window.kakao && window.kakao.maps);
        const hasKakaoServices = Boolean(window.kakao && window.kakao.maps && window.kakao.maps.services && window.kakao.maps.services.Geocoder && window.kakao.maps.services.Places);
        return {
          hasKakaoMaps,
          hasKakaoServices,
          hasFallbackMode: !hasKakaoMaps && text.includes('로컬 편집 모드'),
          hasKoreanUi: text.includes('ADVENTURE TRAIL') && text.includes('Studio') && text.includes('웨이포인트') && text.includes('속성'),
          hasSearchInput: Boolean(searchInput),
          kakaoScripts: Array.from(document.scripts).map((script) => script.src).filter((src) => src.includes('kakao') || src.includes('dapi')),
          mapChildCount: mapCanvas ? mapCanvas.childElementCount : 0,
          statusText: text,
          title: document.title,
        };
      })()`,
    },
    sessionId,
  );
  const value = result.result.value;
  step("checking map click");
  const clickResult = await clickMapCenter(command, sessionId);
  value.pointCountAfterClick = clickResult.pointCountAfterClick;
  value.mapClickChangedPointCount = clickResult.mapClickChangedPointCount;
  step("checking undo/redo");
  const undoRedoResult = await verifyUndoRedo(command, sessionId, clickResult.pointCountAfterClick);
  value.undoChangedPointCount = undoRedoResult.undoChangedPointCount;
  value.redoRestoredPointCount = undoRedoResult.redoRestoredPointCount;
  value.pointCountAfterUndo = undoRedoResult.pointCountAfterUndo;
  value.pointCountAfterRedo = undoRedoResult.pointCountAfterRedo;
  step("checking waypoint creation");
  const waypointResult = await addWaypointViaUi(command, sessionId);
  value.waypointCreateSucceeded = waypointResult.waypointCreateSucceeded;
  value.waypointMessage = waypointResult.waypointMessage;
  step("checking project save");
  const saveResult = await saveProjectViaUi(command, sessionId);
  value.projectSaveMessage = saveResult.projectSaveMessage;
  value.projectSaveSucceeded = saveResult.projectSaveSucceeded;
  step("checking project load");
  const loadResult = await reloadAndOpenSavedProject(command, sessionId, url);
  value.projectLoadMessage = loadResult.projectLoadMessage;
  value.projectLoadPointCount = loadResult.projectLoadPointCount;
  value.projectLoadSucceeded = loadResult.projectLoadSucceeded;
  step("checking point panel insert");
  const pointInsertResult = await verifyPointPanelInsert(command, sessionId);
  value.pointPanelInsertSucceeded = pointInsertResult.pointPanelInsertSucceeded;
  value.pointCountAfterPanelInsert = pointInsertResult.pointCountAfterPanelInsert;
  value.pointPanelInsertMessage = pointInsertResult.pointPanelInsertMessage;
  step("checking GPX drag/drop import");
  const gpxImportResult = await verifyGpxDropImport(command, sessionId);
  value.gpxDropImportSucceeded = gpxImportResult.gpxDropImportSucceeded;
  value.gpxDropImportMessage = gpxImportResult.gpxDropImportMessage;
  step("checking GPX file upload");
  const gpxUploadResult = await verifyGpxFileUpload(command, sessionId);
  value.gpxFileUploadSucceeded = gpxUploadResult.gpxFileUploadSucceeded;
  value.gpxFileUploadMessage = gpxUploadResult.gpxFileUploadMessage;
  step("checking GPX export");
  const exportResult = await verifyGpxExportButtons(command, sessionId);
  value.gpxExportSucceeded = exportResult.gpxExportSucceeded;
  value.gpxExportMessage = exportResult.gpxExportMessage;
  step("checking satellite toggle");
  const mapModeResult = await verifySatelliteToggle(command, sessionId);
  value.satelliteToggleSucceeded = mapModeResult.satelliteToggleSucceeded;
  value.mapModeAfterToggle = mapModeResult.mapModeAfterToggle;
  step("checking map drag");
  const dragResult = await dragMap(command, sessionId);
  value.mapDragChangedPanState = dragResult.mapDragChangedPanState;
  value.panStateBeforeDrag = dragResult.panStateBeforeDrag;
  value.panStateAfterDrag = dragResult.panStateAfterDrag;
  if (value.hasFallbackMode) {
    step("checking fallback search message");
    const searchResult = await submitFallbackSearch(command, sessionId);
    value.fallbackSearchMessage = searchResult.fallbackSearchMessage;
    value.fallbackSearchExplainsKakao = searchResult.fallbackSearchExplainsKakao;
  }
  step("asserting smoke results");
  assertSmoke(value, consoleMessages, networkMessages);
  console.log(
    value.hasKakaoMaps
      ? "Browser smoke check passed with Kakao Maps."
      : "Browser smoke check passed with local fallback map. Kakao Maps is still unavailable for this origin.",
  );
  socket.close();
} catch (error) {
  exitCode = 1;
  console.error(error instanceof Error ? error.message : "Browser smoke check failed.");
} finally {
  chrome.kill("SIGKILL");
  await rm(userDataDir, { force: true, recursive: true });
  process.exit(exitCode);
}

function assertSmoke(value, consoleMessages, networkMessages) {
  const failures = [];
  if (value.title !== "TourMap Editor") failures.push("document title mismatch");
  if (!value.hasKoreanUi) failures.push("Korean editor UI not found");
  if (!value.hasSearchInput) failures.push("address/place search input not found");
  if (!value.hasKakaoMaps && !value.hasFallbackMode) failures.push("Kakao maps SDK was not available and fallback mode was not shown");
  if (!value.hasKakaoServices && !value.hasFallbackMode) failures.push("Kakao Geocoder/Places services were not available");
  if (!value.mapClickChangedPointCount) {
    failures.push(`map click did not add a route point; point count after click was ${value.pointCountAfterClick}`);
  }
  if (!value.undoChangedPointCount || !value.redoRestoredPointCount) {
    failures.push(
      `undo/redo did not restore route point count; afterClick=${value.pointCountAfterClick} afterUndo=${value.pointCountAfterUndo} afterRedo=${value.pointCountAfterRedo}`,
    );
  }
  if (!value.waypointCreateSucceeded) {
    failures.push(`waypoint creation did not succeed through the UI; message=${value.waypointMessage || "none"}`);
  }
  if (!value.projectSaveSucceeded) {
    failures.push(`project save did not succeed through the UI; message=${value.projectSaveMessage || "none"}`);
  }
  if (!value.projectLoadSucceeded) {
    failures.push(`saved project did not reopen through the UI; pointCount=${value.projectLoadPointCount} message=${value.projectLoadMessage || "none"}`);
  }
  if (!value.pointPanelInsertSucceeded) {
    failures.push(`point panel insert did not add a point; count=${value.pointCountAfterPanelInsert || 0} message=${value.pointPanelInsertMessage || "none"}`);
  }
  if (!value.gpxDropImportSucceeded) {
    failures.push(`GPX drag/drop import did not update the project; message=${value.gpxDropImportMessage || "none"}`);
  }
  if (!value.gpxFileUploadSucceeded) {
    failures.push(`GPX file upload did not update the project; message=${value.gpxFileUploadMessage || "none"}`);
  }
  if (!value.gpxExportSucceeded) {
    failures.push(`GPX export buttons did not report success; message=${value.gpxExportMessage || "none"}`);
  }
  if (!value.satelliteToggleSucceeded) {
    failures.push(`satellite map toggle did not update map mode; mode=${value.mapModeAfterToggle || "none"}`);
  }
  if (!value.mapDragChangedPanState) {
    failures.push(`map drag did not change pan state; before=${value.panStateBeforeDrag || "none"} after=${value.panStateAfterDrag || "none"}`);
  }
  if (value.hasFallbackMode && !value.fallbackSearchExplainsKakao) {
    failures.push(`fallback search did not explain Kakao SDK requirement; message=${value.fallbackSearchMessage || "none"}`);
  }
  if (value.mapChildCount < 1 && /카카오맵 SDK|Kakao/.test(value.statusText)) {
    failures.push("map container did not initialize");
  }
  if (failures.length) {
    console.error(`Browser smoke check failed: ${failures.join(", ")}`);
    console.error(`Status text: ${String(value.statusText || "").slice(0, 800)}`);
    if (value.kakaoScripts?.length) {
      console.error(`Kakao scripts: ${value.kakaoScripts.map(redactUrl).join(" | ")}`);
    } else {
      console.error("Kakao scripts: none");
    }
    if (consoleMessages.length) {
      console.error(`Console: ${consoleMessages.slice(-10).join(" | ")}`);
    }
    if (networkMessages.length) {
      console.error(`Network: ${networkMessages.slice(-10).join(" | ")}`);
    }
    process.exit(1);
  }
}

function step(message) {
  console.error(`[smoke] ${message}`);
}

async function clickMapCenter(command, sessionId) {
  await dispatchShortcut(command, sessionId, "d", "KeyD", 68, 0);
  await new Promise((resolve) => setTimeout(resolve, 200));
  const before = await editorPointCount(command, sessionId);
  const rectResult = await command(
    "Runtime.evaluate",
    {
      returnByValue: true,
      expression: `(() => {
        const section = document.querySelector('main > section.relative');
        const rect = section.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`,
    },
    sessionId,
  );
  const { x, y } = rectResult.result.value;
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, sessionId);
  await command("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", buttons: 1, clickCount: 1, x, y }, sessionId);
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", buttons: 0, clickCount: 1, x, y }, sessionId);
  await new Promise((resolve) => setTimeout(resolve, 400));
  const after = await editorPointCount(command, sessionId);
  return {
    mapClickChangedPointCount: after > before,
    pointCountAfterClick: after,
  };
}

async function verifyUndoRedo(command, sessionId, pointCountAfterClick) {
  await dispatchShortcut(command, sessionId, "z", "KeyZ", 90, 4);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const pointCountAfterUndo = await editorPointCount(command, sessionId);
  await dispatchShortcut(command, sessionId, "z", "KeyZ", 90, 12);
  await new Promise((resolve) => setTimeout(resolve, 300));
  const pointCountAfterRedo = await editorPointCount(command, sessionId);
  return {
    pointCountAfterRedo,
    pointCountAfterUndo,
    redoRestoredPointCount: pointCountAfterRedo === pointCountAfterClick,
    undoChangedPointCount: pointCountAfterUndo < pointCountAfterClick,
  };
}

async function dispatchShortcut(command, sessionId, key, code, windowsVirtualKeyCode, modifiers) {
  await command(
    "Input.dispatchKeyEvent",
    { type: "keyDown", key, code, windowsVirtualKeyCode, modifiers },
    sessionId,
  );
  await command(
    "Input.dispatchKeyEvent",
    { type: "keyUp", key, code, windowsVirtualKeyCode, modifiers },
    sessionId,
  );
}

async function addWaypointViaUi(command, sessionId) {
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "p", code: "KeyP", windowsVirtualKeyCode: 80 }, sessionId);
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "p", code: "KeyP", windowsVirtualKeyCode: 80 }, sessionId);
  await waitForBodyText(command, sessionId, "새 핀 유형", 3000);
  const rectResult = await command(
    "Runtime.evaluate",
    {
      returnByValue: true,
      expression: `(() => {
        const section = document.querySelector('main > section.relative');
        const rect = section.getBoundingClientRect();
        return { x: rect.left + rect.width / 2 + 70, y: rect.top + rect.height / 2 - 55 };
      })()`,
    },
    sessionId,
  );
  const { x, y } = rectResult.result.value;
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, sessionId);
  await command("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", buttons: 1, clickCount: 1, x, y }, sessionId);
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", buttons: 0, clickCount: 1, x, y }, sessionId);
  const text = await waitForBodyText(command, sessionId, "웨이포인트\n1", 3000);
  return {
    waypointCreateSucceeded: text.includes("웨이포인트\n1") && text.includes("출발"),
    waypointMessage: text,
  };
}

async function dragMap(command, sessionId) {
  const before = await mapPanState(command, sessionId);
  const rectResult = await command(
    "Runtime.evaluate",
    {
      returnByValue: true,
      expression: `(() => {
        const section = document.querySelector('main > section.relative');
        const rect = section.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      })()`,
    },
    sessionId,
  );
  const { x, y } = rectResult.result.value;
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }, sessionId);
  await command("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", buttons: 1, clickCount: 1, x, y }, sessionId);
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", button: "left", buttons: 1, x: x + 90, y: y + 60 }, sessionId);
  await command("Input.dispatchMouseEvent", { type: "mouseMoved", button: "left", buttons: 1, x: x + 140, y: y + 95 }, sessionId);
  await command("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", buttons: 0, clickCount: 1, x: x + 140, y: y + 95 }, sessionId);
  await new Promise((resolve) => setTimeout(resolve, 400));
  const after = await mapPanState(command, sessionId);
  return {
    mapDragChangedPanState: Boolean(before && after && before !== after),
    panStateBeforeDrag: before,
    panStateAfterDrag: after,
  };
}

async function saveProjectViaUi(command, sessionId) {
  const clickResult = await command(
    "Runtime.evaluate",
    {
      returnByValue: true,
      expression: `(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const button = buttons.find((item) => item.title.includes('저장') || /^저장|저장 필요|저장됨$/.test(item.textContent.trim()));
        if (!button || button.disabled) return false;
        button.click();
        return true;
      })()`,
    },
    sessionId,
  );
  if (!clickResult.result.value) {
    return { projectSaveMessage: "", projectSaveSucceeded: false };
  }
  const message = await waitForBodyText(command, sessionId, "프로젝트를 저장했습니다.", 5000);
  return {
    projectSaveMessage: message,
    projectSaveSucceeded: message.includes("프로젝트를 저장했습니다."),
  };
}

async function reloadAndOpenSavedProject(command, sessionId, pageUrl) {
  await waitForBodyText(command, sessionId, "무제 투어링 코스", 5000);
  const rectResult = await command(
    "Runtime.evaluate",
    {
      returnByValue: true,
      expression: `(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const button = buttons.find((item) => item.textContent.includes('무제 투어링 코스') && item.textContent.includes('1포인트'));
        if (!button) return null;
        button.click();
        return true;
      })()`,
    },
    sessionId,
  );
  const target = rectResult.result.value;
  if (!target) {
    return { projectLoadMessage: "", projectLoadPointCount: 0, projectLoadSucceeded: false };
  }
  const message = await waitForBodyText(command, sessionId, "프로젝트를 열었습니다.", 5000);
  const pointCount = await editorPointCount(command, sessionId);
  const bodyText = await currentBodyText(command, sessionId);
  return {
    projectLoadMessage: message,
    projectLoadPointCount: pointCount,
    projectLoadSucceeded:
      message.includes("프로젝트를 열었습니다.") &&
      pointCount >= 1 &&
      bodyText.includes("웨이포인트\n1") &&
      bodyText.includes("출발"),
  };
}

async function verifyPointPanelInsert(command, sessionId) {
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "d", code: "KeyD", windowsVirtualKeyCode: 68 }, sessionId);
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "d", code: "KeyD", windowsVirtualKeyCode: 68 }, sessionId);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const secondPoint = await clickMapCenter(command, sessionId);
  if (!secondPoint.mapClickChangedPointCount) {
    return {
      pointCountAfterPanelInsert: secondPoint.pointCountAfterClick,
      pointPanelInsertMessage: "second route point was not added",
      pointPanelInsertSucceeded: false,
    };
  }
  const countBeforeInsert = await editorPointCount(command, sessionId);
  const selected = await clickButtonByText(command, sessionId, "포인트 1", "다음 포인트 사이에 삽입");
  if (!selected.includes("다음 포인트 사이에 삽입")) {
    return {
      pointCountAfterPanelInsert: countBeforeInsert,
      pointPanelInsertMessage: selected,
      pointPanelInsertSucceeded: false,
    };
  }
  const inserted = await clickButtonByText(command, sessionId, "다음 포인트 사이에 삽입", "포인트 3");
  await new Promise((resolve) => setTimeout(resolve, 300));
  const countAfterInsert = await editorPointCount(command, sessionId);
  return {
    pointCountAfterPanelInsert: countAfterInsert,
    pointPanelInsertMessage: inserted,
    pointPanelInsertSucceeded: countAfterInsert === countBeforeInsert + 1,
  };
}

async function verifyGpxDropImport(command, sessionId) {
  const dropResult = await command(
    "Runtime.evaluate",
    {
      awaitPromise: true,
      returnByValue: true,
      expression: `new Promise((resolve) => {
        window.confirm = () => true;
        const target = document.querySelector('main > section.relative > div');
        if (!target) {
          resolve({ ok: false, message: 'map drop target not found' });
          return;
        }
        const xml = \`<?xml version="1.0" encoding="UTF-8"?>
          <gpx version="1.1" creator="TourMap Smoke">
            <metadata><name>Smoke GPX Import</name></metadata>
            <trk>
              <name>브라우저 트랙</name>
              <trkseg>
                <trkpt lat="37.560000" lon="126.970000" />
                <trkpt lat="37.565000" lon="126.980000" />
              </trkseg>
            </trk>
            <wpt lat="37.562000" lon="126.975000">
              <name>스모크 휴식</name>
              <type>food</type>
            </wpt>
          </gpx>\`;
        const file = new File([xml], 'smoke-import.gpx', { type: 'application/gpx+xml' });
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer }));
        target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer }));
        const started = Date.now();
        const timer = setInterval(() => {
          const text = document.body.innerText;
          if (text.includes('smoke-import.gpx 가져오기 완료') || Date.now() - started > 5000) {
            clearInterval(timer);
            resolve({
              message: text,
              ok:
                text.includes('smoke-import.gpx 가져오기 완료') &&
                text.includes('브라우저 트랙') &&
                text.includes('포인트 2개') &&
                text.includes('웨이포인트 1개'),
            });
          }
        }, 100);
      })`,
    },
    sessionId,
  );
  const result = dropResult.result.value || {};
  return {
    gpxDropImportMessage: String(result.message || ""),
    gpxDropImportSucceeded: Boolean(result.ok),
  };
}

async function verifyGpxFileUpload(command, sessionId) {
  const filePath = join(userDataDir, "smoke-upload.gpx");
  await writeFile(
    filePath,
    `<?xml version="1.0" encoding="UTF-8"?>
      <gpx version="1.1" creator="TourMap Smoke">
        <metadata><name>Smoke GPX Upload</name></metadata>
        <rte>
          <name>업로드 루트</name>
          <rtept lat="37.570000" lon="126.990000" />
          <rtept lat="37.575000" lon="127.000000" />
          <rtept lat="37.580000" lon="127.010000" />
        </rte>
        <wpt lat="37.572000" lon="126.995000">
          <name>업로드 주유</name>
          <type>fuel</type>
        </wpt>
      </gpx>`,
    "utf8",
  );
  await command("DOM.enable", {}, sessionId);
  const documentResult = await command("DOM.getDocument", {}, sessionId);
  const inputResult = await command(
    "DOM.querySelector",
    {
      nodeId: documentResult.root.nodeId,
      selector: 'input[type="file"][accept=".gpx"]',
    },
    sessionId,
  );
  const nodeId = inputResult.nodeId;
  if (!nodeId) {
    return {
      gpxFileUploadMessage: "GPX file input not found",
      gpxFileUploadSucceeded: false,
    };
  }
  await command("DOM.setFileInputFiles", { files: [filePath], nodeId }, sessionId);
  const result = await command(
    "Runtime.evaluate",
    {
      awaitPromise: true,
      returnByValue: true,
      expression: `new Promise((resolve) => {
        window.confirm = () => true;
        const started = Date.now();
        const timer = setInterval(() => {
          const text = document.body.innerText;
          if (text.includes('smoke-upload.gpx 가져오기 완료') || Date.now() - started > 5000) {
            clearInterval(timer);
            resolve({
              message: text,
              ok:
                text.includes('smoke-upload.gpx 가져오기 완료') &&
                text.includes('업로드 루트') &&
                text.includes('포인트 3개') &&
                text.includes('웨이포인트 1개'),
            });
          }
        }, 100);
      })`,
    },
    sessionId,
  );
  const value = result.result.value || {};
  return {
    gpxFileUploadMessage: String(value.message || ""),
    gpxFileUploadSucceeded: Boolean(value.ok),
  };
}

async function verifyGpxExportButtons(command, sessionId) {
  await command(
    "Runtime.evaluate",
    {
      expression: `(() => {
        window.__tourMapDownloads = [];
        if (!window.__tourMapDownloadClickPatched) {
          const originalClick = HTMLAnchorElement.prototype.click;
          HTMLAnchorElement.prototype.click = function patchedClick() {
            if (this.download && String(this.href).startsWith('blob:')) {
              window.__tourMapDownloads.push(this.download);
              return;
            }
            return originalClick.call(this);
          };
          window.__tourMapDownloadClickPatched = true;
        }
      })()`,
    },
    sessionId,
  );
  const exportMessage = await clickButtonByText(command, sessionId, "GPX 내보내기", "GPX를 내보냈습니다.");
  const downloadsResult = await command(
    "Runtime.evaluate",
    {
      returnByValue: true,
      expression: "window.__tourMapDownloads || []",
    },
    sessionId,
  );
  const downloads = downloadsResult.result.value || [];
  return {
    gpxExportMessage: exportMessage,
    gpxExportSucceeded: exportMessage.includes("GPX를 내보냈습니다.") && downloads.some((name) => String(name).endsWith(".gpx")),
  };
}

async function verifySatelliteToggle(command, sessionId) {
  const toggleResult = await command(
    "Runtime.evaluate",
    {
      returnByValue: true,
      expression: `(() => {
        const label = Array.from(document.querySelectorAll('label')).find((item) => item.textContent.includes('위성 지도'));
        const input = label ? label.querySelector('input[type="checkbox"]') : null;
        if (!input) return false;
        input.scrollIntoView({ block: 'center', inline: 'center' });
        if (!input.checked) input.click();
        return true;
      })()`,
    },
    sessionId,
  );
  if (!toggleResult.result.value) {
    return { mapModeAfterToggle: "", satelliteToggleSucceeded: false };
  }
  await new Promise((resolve) => setTimeout(resolve, 300));
  const modeResult = await command(
    "Runtime.evaluate",
    {
      returnByValue: true,
      expression: `(() => {
        const canvas = document.querySelector('section.relative div.absolute.inset-0[data-mode]');
        return canvas ? canvas.dataset.mode || '' : '';
      })()`,
    },
    sessionId,
  );
  const mode = String(modeResult.result.value || "");
  return {
    mapModeAfterToggle: mode,
    satelliteToggleSucceeded: mode === "satellite",
  };
}

async function clickButtonByText(command, sessionId, buttonText, expectedMessage) {
  const clickResult = await command(
    "Runtime.evaluate",
    {
      returnByValue: true,
      expression: `(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const button = buttons.find((item) => {
          const text = item.textContent.trim();
          return !item.disabled && (text === ${JSON.stringify(buttonText)} || text.includes(${JSON.stringify(buttonText)}));
        });
        if (!button) return false;
        button.scrollIntoView({ block: 'center', inline: 'center' });
        button.click();
        return true;
      })()`,
    },
    sessionId,
  );
  if (!clickResult.result.value) return "";
  return waitForBodyText(command, sessionId, expectedMessage, 3000);
}

async function mapPanState(command, sessionId) {
  const result = await command(
    "Runtime.evaluate",
    {
      returnByValue: true,
      expression: `(() => {
        const canvas = document.querySelector('section.relative div.absolute.inset-0[data-pan-state]');
        return canvas ? canvas.dataset.panState || "" : "";
      })()`,
    },
    sessionId,
  );
  return String(result.result.value || "");
}

async function waitForBodyText(command, sessionId, expected, timeoutMs) {
  const result = await command(
    "Runtime.evaluate",
    {
      awaitPromise: true,
      returnByValue: true,
      expression: `new Promise((resolve) => {
        const started = Date.now();
        const timer = setInterval(() => {
          const text = document.body.innerText;
          if (text.includes(${JSON.stringify(expected)}) || Date.now() - started > ${timeoutMs}) {
            clearInterval(timer);
            resolve(text);
          }
        }, 100);
      })`,
    },
    sessionId,
  );
  return String(result.result.value || "");
}

async function currentBodyText(command, sessionId) {
  const result = await command(
    "Runtime.evaluate",
    {
      returnByValue: true,
      expression: "document.body.innerText",
    },
    sessionId,
  );
  return String(result.result.value || "");
}

async function submitFallbackSearch(command, sessionId) {
  await command(
    "Runtime.evaluate",
    {
      expression: `(() => {
        const input = document.querySelector('input[placeholder="주소 또는 장소 검색"]');
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, '서울시청');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.form.requestSubmit();
      })()`,
    },
    sessionId,
  );
  await new Promise((resolve) => setTimeout(resolve, 600));
  const messageResult = await command(
    "Runtime.evaluate",
    {
      returnByValue: true,
      expression: `(() => {
        const text = document.body.innerText;
        const match = text.match(/주소 검색은 카카오맵 SDK가 연결되어야 사용할 수 있습니다\\.[^\\n]*/);
        return match ? match[0] : '';
      })()`,
    },
    sessionId,
  );
  const message = String(messageResult.result.value || "");
  return {
    fallbackSearchMessage: message,
    fallbackSearchExplainsKakao: message.includes("카카오맵 SDK"),
  };
}

async function editorPointCount(command, sessionId) {
  const result = await command(
    "Runtime.evaluate",
    {
      returnByValue: true,
      expression: `(() => {
        const matches = Array.from(document.body.innerText.matchAll(/(\\d+)개 포인트/g));
        return matches.length ? Number(matches.at(-1)[1]) : 0;
      })()`,
    },
    sessionId,
  );
  return Number(result.result.value || 0);
}

async function waitForEditorReady(command, sessionId) {
  await command(
    "Runtime.evaluate",
    {
      awaitPromise: true,
      expression: `new Promise((resolve) => {
        const started = Date.now();
        const timer = setInterval(() => {
          const text = document.body.innerText;
          const ready =
            Boolean(window.kakao && window.kakao.maps && window.kakao.maps.services) ||
            text.includes('불러오지 못했습니다');
          if ((document.readyState === 'complete' && ready) || Date.now() - started > 20000) {
            clearInterval(timer);
            resolve(true);
          }
        }, 200);
      })`,
    },
    sessionId,
  );
}

async function waitForDevTools(port) {
  const started = Date.now();
  while (Date.now() - started < 5000) {
    try {
      await fetchJson(`http://127.0.0.1:${port}/json/version`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  const detail = chromeErrors.join("").trim();
  throw new Error(
    detail
      ? `Chrome DevTools endpoint did not start.\n${detail}`
      : "Chrome DevTools endpoint did not start.",
  );
}

async function fetchJson(targetUrl) {
  const response = await fetch(targetUrl);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${targetUrl}`);
  return response.json();
}

function once(target, eventName) {
  return new Promise((resolve, reject) => {
    target.addEventListener(eventName, resolve, { once: true });
    target.addEventListener("error", reject, { once: true });
  });
}

function redactUrl(value) {
  return String(value).replace(/appkey=[^&]+/g, "appkey=<redacted>");
}
