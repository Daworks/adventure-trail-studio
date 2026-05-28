const STORAGE_KEY = "tourflow-map-studio:v1";
const WAYPOINT_TYPES = ["start", "finish", "fuel", "food", "camp", "warning"];
const WAYPOINT_LABELS = {
  start: "S",
  finish: "F",
  fuel: "G",
  food: "E",
  camp: "C",
  warning: "!",
};

const mapEl = document.getElementById("map");
const tileLayer = document.getElementById("tileLayer");
const routeLayer = document.getElementById("routeLayer");
const markerLayer = document.getElementById("markerLayer");
const adapter = new window.OSMTileAdapter(tileLayer);

const app = {
  view: {
    center: { lat: 37.5665, lng: 126.978 },
    zoom: 11,
    width: 0,
    height: 0,
  },
  state: createInitialState(),
  history: [],
  future: [],
  tool: "draw",
  selected: null,
  drag: null,
  mapDrag: null,
  suppressClick: false,
  layers: {
    routes: true,
    waypoints: true,
    warnings: true,
    photos: true,
    labels: true,
  },
};

loadState();
bindEvents();
measure();
render();
showToast("그리기 모드: 지도를 클릭해 코스를 만드세요. 빈 지도를 드래그하면 지도를 이동할 수 있습니다.");

function createInitialState() {
  const initialSegmentId = uid("seg");
  return {
    project: {
      name: "무제 투어링 코스",
      description: "어드벤처 코스 초안",
      author: "TourFlow",
      avgSpeed: 45,
    },
    activeSegmentId: initialSegmentId,
    importedFiles: [],
    segments: [
      {
        id: initialSegmentId,
        name: "구간 1",
        points: [],
      },
    ],
    waypoints: [],
  };
}

function bindEvents() {
  window.addEventListener("resize", () => {
    measure();
    render();
  });

  mapEl.addEventListener("click", onMapClick);
  mapEl.addEventListener("pointerdown", onMapPointerDown);
  mapEl.addEventListener("pointermove", onMapPointerMove);
  mapEl.addEventListener("pointerup", onMapPointerUp);
  mapEl.addEventListener("pointercancel", onMapPointerUp);
  mapEl.addEventListener("wheel", onWheel, { passive: false });
  mapEl.addEventListener("contextmenu", (event) => event.preventDefault());
  mapEl.addEventListener("mousemove", updateCursorPosition);

  document.querySelectorAll("[data-tool]").forEach((button) => {
    button.addEventListener("click", () => setTool(button.dataset.tool));
  });

  document.querySelectorAll("[data-layer]").forEach((input) => {
    input.addEventListener("change", () => {
      app.layers[input.dataset.layer] = input.checked;
      render();
    });
  });

  document.getElementById("satelliteToggle").addEventListener("change", (event) => {
    adapter.setMode(event.target.checked ? "satellite" : "standard");
    document.getElementById("mapModeText").textContent = event.target.checked ? "위성" : "일반";
    render();
  });

  document.getElementById("zoomInBtn").addEventListener("click", () => zoomBy(1));
  document.getElementById("zoomOutBtn").addEventListener("click", () => zoomBy(-1));
  document.getElementById("addressSearchForm").addEventListener("submit", searchAddress);
  document.getElementById("undoBtn").addEventListener("click", undo);
  document.getElementById("redoBtn").addEventListener("click", redo);
  document.getElementById("newSegmentBtn").addEventListener("click", newSegment);
  document.getElementById("fitRouteBtn").addEventListener("click", fitRoute);
  document.getElementById("focusSegmentBtn").addEventListener("click", focusSelectedSegment);
  document.getElementById("splitBtn").addEventListener("click", splitAtSelectedPoint);
  document.getElementById("mergeBtn").addEventListener("click", mergeSegments);
  document.getElementById("deleteSegmentBtn").addEventListener("click", deleteSelectedSegment);
  document.getElementById("exportTrackBtn").addEventListener("click", () => exportGpx("track"));
  document.getElementById("exportRouteBtn").addEventListener("click", () => exportGpx("route"));
  document.getElementById("gpxInput").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    if (file) importGpx(file);
    event.target.value = "";
  });

  ["projectName", "projectDescription", "projectAuthor", "avgSpeed"].forEach((id) => {
    document.getElementById(id).addEventListener("change", updateProjectFromInputs);
  });

  const dropZone = document.getElementById("dropZone");
  dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropZone.classList.add("drag-over");
  });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
  dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropZone.classList.remove("drag-over");
    const file = Array.from(event.dataTransfer.files).find((item) =>
      item.name.toLowerCase().endsWith(".gpx"),
    );
    if (file) importGpx(file);
  });

  window.addEventListener("keydown", (event) => {
    const meta = event.metaKey || event.ctrlKey;
    if (meta && event.key.toLowerCase() === "z" && event.shiftKey) {
      event.preventDefault();
      redo();
    } else if (meta && event.key.toLowerCase() === "z") {
      event.preventDefault();
      undo();
    } else if (event.key === "Delete" || event.key === "Backspace") {
      if (app.selected) {
        event.preventDefault();
        deleteSelection();
      }
    } else if (event.key === "Escape") {
      app.selected = null;
      render();
    }
  });
}

function measure() {
  const rect = mapEl.getBoundingClientRect();
  app.view.width = rect.width;
  app.view.height = rect.height;
  routeLayer.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
}

function render() {
  adapter.renderTiles(app.view);
  renderRoutes();
  renderMarkers();
  renderSidebar();
  persistState();
}

function renderRoutes() {
  routeLayer.innerHTML = "";
  routeLayer.style.display = app.layers.routes ? "block" : "none";
  if (!app.layers.routes) return;

  app.state.segments.forEach((segment) => {
    if (segment.points.length < 2) return;
    const d = segment.points
      .map((point, index) => {
        const screen = toScreen(point);
        return `${index === 0 ? "M" : "L"} ${screen.x.toFixed(1)} ${screen.y.toFixed(1)}`;
      })
      .join(" ");

    const path = svg("path", {
      class: "route-path",
      d,
      "data-segment-id": segment.id,
    });
    const hit = svg("path", {
      class: "route-hit",
      d,
      "data-segment-id": segment.id,
    });
    hit.addEventListener("click", (event) => {
      event.stopPropagation();
      if (app.tool === "insert") {
        const point = screenToLatLng(event.offsetX, event.offsetY);
        insertPointOnNearestSegment(segment.id, point);
      } else {
        app.state.activeSegmentId = segment.id;
        app.selected = { type: "segment", segmentId: segment.id };
        render();
      }
    });
    routeLayer.appendChild(path);
    routeLayer.appendChild(hit);
  });
}

function renderMarkers() {
  markerLayer.innerHTML = "";

  if (app.layers.routes) {
    app.state.segments.forEach((segment) => {
      segment.points.forEach((point, pointIndex) => {
        const screen = toScreen(point);
        const marker = document.createElement("button");
        marker.className = "point-marker";
        if (isSelectedPoint(segment.id, point.id)) marker.classList.add("active");
        marker.style.left = `${screen.x}px`;
        marker.style.top = `${screen.y}px`;
        marker.title = `Point ${pointIndex + 1}`;
        marker.textContent = pointIndex === 0 ? "A" : pointIndex === segment.points.length - 1 ? "B" : "";
        marker.addEventListener("click", (event) => {
          event.stopPropagation();
          app.state.activeSegmentId = segment.id;
          app.selected = { type: "point", segmentId: segment.id, pointId: point.id };
          setTool("select");
          render();
        });
        marker.addEventListener("contextmenu", (event) => {
          event.preventDefault();
          event.stopPropagation();
          app.selected = { type: "point", segmentId: segment.id, pointId: point.id };
          deleteSelection();
        });
        marker.addEventListener("pointerdown", (event) => {
          event.stopPropagation();
          app.state.activeSegmentId = segment.id;
          app.selected = { type: "point", segmentId: segment.id, pointId: point.id };
          startPointDrag(event, point);
        });
        markerLayer.appendChild(marker);
      });
    });
  }

  if (app.layers.waypoints) {
    app.state.waypoints.filter(shouldRenderWaypoint).forEach((waypoint) => {
      const screen = toScreen(waypoint);
      const marker = document.createElement("button");
      marker.className = "waypoint-marker";
      if (isSelectedWaypoint(waypoint.id)) marker.classList.add("active");
      marker.style.left = `${screen.x}px`;
      marker.style.top = `${screen.y}px`;
      marker.title = waypoint.title;
      marker.textContent = WAYPOINT_LABELS[waypoint.type] || "P";
      marker.style.background = waypoint.color || "#1f6b53";
      marker.addEventListener("click", (event) => {
        event.stopPropagation();
        app.selected = { type: "waypoint", waypointId: waypoint.id };
        setTool("select");
        render();
      });
      marker.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        app.selected = { type: "waypoint", waypointId: waypoint.id };
        deleteSelection();
      });
      marker.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
        app.selected = { type: "waypoint", waypointId: waypoint.id };
        startWaypointDrag(event, waypoint);
      });
      if (app.layers.labels) {
        const label = document.createElement("span");
        label.className = "marker-label";
        label.textContent = waypoint.title;
        marker.appendChild(label);
      }
      markerLayer.appendChild(marker);
    });
  }
}

function renderSidebar() {
  const totalPoints = app.state.segments.reduce((sum, segment) => sum + segment.points.length, 0);
  document.getElementById("pointCount").textContent = `${totalPoints} pts`;
  document.getElementById("segmentCount").textContent = String(app.state.segments.length);
  document.getElementById("waypointCount").textContent = String(app.state.waypoints.length);

  document.getElementById("projectName").value = app.state.project.name;
  document.getElementById("projectDescription").value = app.state.project.description;
  document.getElementById("projectAuthor").value = app.state.project.author;
  document.getElementById("avgSpeed").value = app.state.project.avgSpeed;

  renderSegmentList();
  renderGpxList();
  renderWaypointList();
  renderSelectionEditor();
  updateStatus(totalPoints);
}

function renderGpxList() {
  const list = document.getElementById("gpxList");
  list.innerHTML = "";
  const files = app.state.importedFiles || [];
  files.slice(-4).forEach((file) => {
    const row = document.createElement("div");
    row.className = "list-item";
    row.innerHTML = `<strong>GPX</strong><span>${escapeHtml(file.name)}</span>`;
    list.appendChild(row);
  });
}

function renderSegmentList() {
  const list = document.getElementById("segmentList");
  list.innerHTML = "";
  app.state.segments.forEach((segment, index) => {
    const button = document.createElement("button");
    button.className = "list-item";
    if (segment.id === app.state.activeSegmentId) button.classList.add("active");
    button.innerHTML = `<strong>${escapeHtml(segment.name || `구간 ${index + 1}`)}</strong><span>${segment.points.length}개 포인트 · ${formatDistance(segmentDistance(segment))}</span>`;
    button.addEventListener("click", () => {
      app.state.activeSegmentId = segment.id;
      app.selected = { type: "segment", segmentId: segment.id };
      render();
    });
    list.appendChild(button);
  });
}

function renderWaypointList() {
  const list = document.getElementById("waypointList");
  list.innerHTML = "";
  if (!app.state.waypoints.length) {
    list.innerHTML = `<div class="empty-copy">아직 웨이포인트가 없습니다.</div>`;
    return;
  }
  app.state.waypoints.forEach((waypoint) => {
    const button = document.createElement("button");
    button.className = "list-item";
    if (isSelectedWaypoint(waypoint.id)) button.classList.add("active");
    button.innerHTML = `<strong>${WAYPOINT_LABELS[waypoint.type] || "P"}</strong><span>${escapeHtml(waypoint.title)}</span>`;
    button.addEventListener("click", () => {
      app.selected = { type: "waypoint", waypointId: waypoint.id };
      render();
    });
    list.appendChild(button);
  });
}

function renderSelectionEditor() {
  const type = document.getElementById("selectionType");
  const details = document.getElementById("selectionDetails");
  if (!app.selected) {
    type.textContent = "없음";
    details.className = "empty-copy";
    details.textContent = "포인트나 웨이포인트를 선택하면 속성을 편집할 수 있습니다.";
    return;
  }

  if (app.selected.type === "point") {
    const point = getSelectedPoint();
    type.textContent = "포인트";
    details.className = "";
    details.innerHTML = `
      <label class="field-label">위도 <input id="selectedLat" type="number" step="0.000001" value="${point.lat}"></label>
      <label class="field-label">경도 <input id="selectedLng" type="number" step="0.000001" value="${point.lng}"></label>
      <button id="applyPointBtn" class="primary-button">포인트 적용</button>
    `;
    document.getElementById("applyPointBtn").addEventListener("click", () => {
      commitHistory();
      point.lat = Number(document.getElementById("selectedLat").value);
      point.lng = Number(document.getElementById("selectedLng").value);
      render();
    });
    return;
  }

  if (app.selected.type === "waypoint") {
    const waypoint = getSelectedWaypoint();
    type.textContent = "웨이포인트";
    details.className = "";
    details.innerHTML = `
      <label class="field-label">유형 <select id="waypointType">${WAYPOINT_TYPES.map(
        (item) => `<option value="${item}" ${item === waypoint.type ? "selected" : ""}>${item}</option>`,
      ).join("")}</select></label>
      <label class="field-label">이름 <input id="waypointTitle" type="text" value="${escapeAttr(waypoint.title)}"></label>
      <label class="field-label">설명 <textarea id="waypointDescription" rows="3">${escapeHtml(
        waypoint.description || "",
      )}</textarea></label>
      <label class="field-label">색상 <input id="waypointColor" type="color" value="${waypoint.color || "#1f6b53"}"></label>
      <button id="applyWaypointBtn" class="primary-button">웨이포인트 적용</button>
    `;
    document.getElementById("applyWaypointBtn").addEventListener("click", () => {
      commitHistory();
      waypoint.type = document.getElementById("waypointType").value;
      waypoint.title = document.getElementById("waypointTitle").value;
      waypoint.description = document.getElementById("waypointDescription").value;
      waypoint.color = document.getElementById("waypointColor").value;
      render();
    });
    return;
  }

  if (app.selected.type === "segment") {
    const segment = getSegment(app.selected.segmentId);
    type.textContent = "구간";
    details.className = "";
    details.innerHTML = `
      <label class="field-label">이름 <input id="segmentName" type="text" value="${escapeAttr(segment.name)}"></label>
      <div class="empty-copy">${segment.points.length}개 포인트 · ${formatDistance(segmentDistance(segment))}</div>
      <button id="applySegmentBtn" class="primary-button">구간 적용</button>
    `;
    document.getElementById("applySegmentBtn").addEventListener("click", () => {
      commitHistory();
      segment.name = document.getElementById("segmentName").value;
      render();
    });
  }
}

function updateStatus(totalPoints) {
  const distance = totalDistance();
  const activeSegment = getActiveSegment();
  const speed = Number(app.state.project.avgSpeed) || 1;
  const minutes = Math.round((distance / speed) * 60);
  document.getElementById("totalDistance").textContent = formatDistance(distance);
  document.getElementById("eta").textContent = `${Math.floor(minutes / 60)}h ${String(
    minutes % 60,
  ).padStart(2, "0")}m`;
  document.getElementById("segmentInfo").textContent = `${activeSegment.name} · ${formatDistance(
    segmentDistance(activeSegment),
  )}`;
  document.getElementById("activeToolLabel").textContent = `${labelTool(app.tool)} 모드`;
  document.getElementById("undoBtn").disabled = app.history.length === 0;
  document.getElementById("redoBtn").disabled = app.future.length === 0;
  if (!totalPoints) document.getElementById("cursorPosition").textContent = "클릭해서 시작";
}

function onMapClick(event) {
  if (!isMapSurface(event.target)) return;
  if (app.suppressClick) {
    app.suppressClick = false;
    return;
  }
  const latLng = eventToLatLng(event);
  if (app.tool === "draw") addPoint(latLng);
  if (app.tool === "waypoint") addWaypoint(latLng);
}

function onMapPointerDown(event) {
  if (!isMapSurface(event.target)) return;
  app.mapDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    centerStart: { ...app.view.center },
    moved: false,
  };
  mapEl.setPointerCapture(event.pointerId);
}

function onMapPointerMove(event) {
  if (app.drag) {
    const latLng = eventToLatLng(event);
    if (app.drag.type === "point") {
      app.drag.point.lat = latLng.lat;
      app.drag.point.lng = latLng.lng;
    } else if (app.drag.type === "waypoint") {
      app.drag.waypoint.lat = latLng.lat;
      app.drag.waypoint.lng = latLng.lng;
    }
    render();
    return;
  }

  if (!app.mapDrag) return;
  const dx = event.clientX - app.mapDrag.startX;
  const dy = event.clientY - app.mapDrag.startY;
  if (Math.abs(dx) + Math.abs(dy) > 3) app.mapDrag.moved = true;
  const startWorld = adapter.latLngToWorld(
    app.mapDrag.centerStart.lat,
    app.mapDrag.centerStart.lng,
    app.view.zoom,
  );
  app.view.center = adapter.worldToLatLng(startWorld.x - dx, startWorld.y - dy, app.view.zoom);
  mapEl.classList.add("is-panning");
  render();
}

function onMapPointerUp(event) {
  if (app.drag) {
    app.drag = null;
    persistState();
    render();
  }
  if (app.mapDrag?.pointerId === event.pointerId) {
    if (app.mapDrag.moved) {
      app.suppressClick = true;
      window.setTimeout(() => {
        app.suppressClick = false;
      }, 0);
    }
    app.mapDrag = null;
    mapEl.classList.remove("is-panning");
  }
}

function startPointDrag(event, point) {
  commitHistory();
  app.drag = { type: "point", point };
  event.currentTarget.setPointerCapture(event.pointerId);
}

function startWaypointDrag(event, waypoint) {
  commitHistory();
  app.drag = { type: "waypoint", waypoint };
  event.currentTarget.setPointerCapture(event.pointerId);
}

function onWheel(event) {
  event.preventDefault();
  zoomBy(event.deltaY > 0 ? -1 : 1);
}

function zoomBy(delta) {
  app.view.zoom = clamp(app.view.zoom + delta, 3, 18);
  render();
}

async function searchAddress(event) {
  event.preventDefault();
  const input = document.getElementById("addressSearchInput");
  const status = document.getElementById("addressSearchStatus");
  const query = input.value.trim();
  if (!query) return;
  status.textContent = "검색 중...";
  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "1");
    url.searchParams.set("q", query);
    const response = await fetch(url.toString(), {
      headers: { accept: "application/json" },
    });
    if (!response.ok) throw new Error("주소 검색 요청에 실패했습니다.");
    const results = await response.json();
    if (!results[0]) throw new Error("검색 결과가 없습니다.");
    app.view.center = {
      lat: Number(results[0].lat),
      lng: Number(results[0].lon),
    };
    app.view.zoom = Math.max(app.view.zoom, 14);
    render();
    status.textContent = "검색 위치로 이동했습니다.";
  } catch (error) {
    status.textContent = error.message || "주소 검색에 실패했습니다.";
  }
}

function addPoint(latLng) {
  commitHistory();
  const segment = getActiveSegment();
  segment.points.push({ id: uid("pt"), ...latLng });
  app.selected = { type: "point", segmentId: segment.id, pointId: segment.points.at(-1).id };
  render();
}

function insertPointOnNearestSegment(segmentId, latLng) {
  const segment = getSegment(segmentId);
  if (!segment || segment.points.length < 2) return;
  commitHistory();
  let bestIndex = 1;
  let bestDistance = Infinity;
  for (let index = 0; index < segment.points.length - 1; index += 1) {
    const a = toScreen(segment.points[index]);
    const b = toScreen(segment.points[index + 1]);
    const p = toScreen(latLng);
    const distance = pointToSegmentDistance(p, a, b);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index + 1;
    }
  }
  const point = { id: uid("pt"), ...latLng };
  segment.points.splice(bestIndex, 0, point);
  app.selected = { type: "point", segmentId, pointId: point.id };
  render();
}

function addWaypoint(latLng) {
  commitHistory();
  const waypoint = {
    id: uid("wpt"),
    type: app.state.waypoints.length ? "warning" : "start",
    title: app.state.waypoints.length ? `웨이포인트 ${app.state.waypoints.length + 1}` : "출발",
    description: "",
    color: "#1f6b53",
    ...latLng,
  };
  app.state.waypoints.push(waypoint);
  app.selected = { type: "waypoint", waypointId: waypoint.id };
  render();
}

function newSegment() {
  commitHistory();
  const segment = {
    id: uid("seg"),
    name: `구간 ${app.state.segments.length + 1}`,
    points: [],
  };
  app.state.segments.push(segment);
  app.state.activeSegmentId = segment.id;
  app.selected = { type: "segment", segmentId: segment.id };
  setTool("draw");
  render();
}

function splitAtSelectedPoint() {
  if (!app.selected || app.selected.type !== "point") {
    showToast("나눌 코스 포인트를 선택하세요.");
    return;
  }
  const segment = getSegment(app.selected.segmentId);
  const index = segment.points.findIndex((point) => point.id === app.selected.pointId);
  if (index <= 0 || index >= segment.points.length - 1) {
    showToast("구간 중간 포인트를 선택하세요.");
    return;
  }
  commitHistory();
  const nextPoints = segment.points.slice(index);
  segment.points = segment.points.slice(0, index + 1);
  const newSeg = {
    id: uid("seg"),
    name: `${segment.name} 분할`,
    points: nextPoints.map((point, nextIndex) => ({
      ...point,
      id: nextIndex === 0 ? point.id : uid("pt"),
    })),
  };
  app.state.segments.splice(app.state.segments.indexOf(segment) + 1, 0, newSeg);
  app.state.activeSegmentId = newSeg.id;
  app.selected = { type: "segment", segmentId: newSeg.id };
  render();
}

function mergeSegments() {
  if (app.state.segments.length < 2) return;
  commitHistory();
  const activeIndex = app.state.segments.findIndex(
    (segment) => segment.id === app.state.activeSegmentId,
  );
  const index = activeIndex >= 0 ? activeIndex : 0;
  const current = app.state.segments[index];
  const next = app.state.segments[index + 1] || app.state.segments[index - 1];
  if (!next) return;
  current.points = current.points.concat(next.points.map((point) => ({ ...point, id: uid("pt") })));
  app.state.segments = app.state.segments.filter((segment) => segment.id !== next.id);
  app.selected = { type: "segment", segmentId: current.id };
  render();
}

function deleteSelectedSegment() {
  const id =
    app.selected?.type === "segment" ? app.selected.segmentId : app.state.activeSegmentId;
  if (app.state.segments.length <= 1) {
    showToast("At least one segment is required.");
    return;
  }
  commitHistory();
  app.state.segments = app.state.segments.filter((segment) => segment.id !== id);
  app.state.activeSegmentId = app.state.segments[0].id;
  app.selected = { type: "segment", segmentId: app.state.activeSegmentId };
  render();
}

function deleteSelection() {
  if (!app.selected) return;
  commitHistory();
  if (app.selected.type === "point") {
    const segment = getSegment(app.selected.segmentId);
    segment.points = segment.points.filter((point) => point.id !== app.selected.pointId);
  }
  if (app.selected.type === "waypoint") {
    app.state.waypoints = app.state.waypoints.filter(
      (waypoint) => waypoint.id !== app.selected.waypointId,
    );
  }
  if (app.selected.type === "segment") {
    const id = app.selected.segmentId;
    if (app.state.segments.length <= 1) {
      app.history.pop();
      showToast("At least one segment is required.");
      return;
    }
    app.state.segments = app.state.segments.filter((segment) => segment.id !== id);
    app.state.activeSegmentId = app.state.segments[0].id;
  }
  app.selected = null;
  render();
}

function fitRoute() {
  const coords = [
    ...app.state.segments.flatMap((segment) => segment.points),
    ...app.state.waypoints,
  ];
  fitCoordinates(coords);
}

function focusSelectedSegment() {
  const segmentId =
    app.selected?.type === "segment" || app.selected?.type === "point"
      ? app.selected.segmentId
      : app.state.activeSegmentId;
  const segment = getSegment(segmentId);
  if (!segment || !segment.points.length) {
    showToast("포인트가 있는 구간을 선택하세요.");
    return;
  }
  fitCoordinates(segment.points);
}

function fitCoordinates(coords) {
  if (!coords.length) return;
  const minLat = Math.min(...coords.map((point) => point.lat));
  const maxLat = Math.max(...coords.map((point) => point.lat));
  const minLng = Math.min(...coords.map((point) => point.lng));
  const maxLng = Math.max(...coords.map((point) => point.lng));
  app.view.center = {
    lat: (minLat + maxLat) / 2,
    lng: (minLng + maxLng) / 2,
  };
  for (let zoom = 18; zoom >= 3; zoom -= 1) {
    const nw = adapter.latLngToWorld(maxLat, minLng, zoom);
    const se = adapter.latLngToWorld(minLat, maxLng, zoom);
    if (
      Math.abs(se.x - nw.x) < app.view.width - 120 &&
      Math.abs(se.y - nw.y) < app.view.height - 120
    ) {
      app.view.zoom = zoom;
      break;
    }
  }
  render();
}

function importGpx(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = window.GPX.parse(String(reader.result));
      commitHistory();
      app.state.segments = parsed.segments.length
        ? parsed.segments.map((segment, index) => ({
            id: uid("seg"),
            name: `Imported ${index + 1}`,
            points: segment.points.map((point) => ({ id: uid("pt"), ...point })),
          }))
        : app.state.segments;
      app.state.waypoints = parsed.waypoints.map((waypoint) => ({
        id: uid("wpt"),
        ...waypoint,
      }));
      app.state.importedFiles = [
        ...(app.state.importedFiles || []),
        {
          name: file.name,
          importedAt: new Date().toISOString(),
          segments: parsed.segments.length,
          waypoints: parsed.waypoints.length,
        },
      ];
      app.state.activeSegmentId = app.state.segments[0].id;
      app.selected = { type: "segment", segmentId: app.state.activeSegmentId };
      fitRoute();
      showToast("GPX를 가져왔습니다.");
    } catch (error) {
      showToast(error.message);
    }
  };
  reader.readAsText(file);
}

function exportGpx(type) {
  const xml = type === "track" ? window.GPX.exportTrack(app.state) : window.GPX.exportRoute(app.state);
  const blob = new Blob([xml], { type: "application/gpx+xml" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const name = app.state.project.name.trim().replace(/[^a-z0-9가-힣_-]+/gi, "-") || "route";
  link.href = url;
  link.download = `${name}-${type}.gpx`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function updateProjectFromInputs() {
  commitHistory();
  app.state.project.name = document.getElementById("projectName").value;
  app.state.project.description = document.getElementById("projectDescription").value;
  app.state.project.author = document.getElementById("projectAuthor").value;
  app.state.project.avgSpeed = Number(document.getElementById("avgSpeed").value);
  render();
}

function setTool(tool) {
  app.tool = tool;
  document.querySelectorAll("[data-tool]").forEach((button) => {
    button.classList.toggle("active", button.dataset.tool === tool);
  });
  render();
}

function commitHistory() {
  app.history.push(JSON.stringify(app.state));
  if (app.history.length > 80) app.history.shift();
  app.future = [];
}

function undo() {
  if (!app.history.length) return;
  app.future.push(JSON.stringify(app.state));
  app.state = JSON.parse(app.history.pop());
  app.selected = null;
  render();
}

function redo() {
  if (!app.future.length) return;
  app.history.push(JSON.stringify(app.state));
  app.state = JSON.parse(app.future.pop());
  app.selected = null;
  render();
}

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) app.state = JSON.parse(saved);
    app.state.importedFiles ||= [];
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function persistState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(app.state));
}

function updateCursorPosition(event) {
  const latLng = eventToLatLng(event);
  document.getElementById("cursorPosition").textContent = `위도 ${latLng.lat.toFixed(
    5,
  )}, 경도 ${latLng.lng.toFixed(5)}`;
}

function eventToLatLng(event) {
  const rect = mapEl.getBoundingClientRect();
  return screenToLatLng(event.clientX - rect.left, event.clientY - rect.top);
}

function screenToLatLng(x, y) {
  const centerWorld = adapter.latLngToWorld(app.view.center.lat, app.view.center.lng, app.view.zoom);
  return adapter.worldToLatLng(
    centerWorld.x - app.view.width / 2 + x,
    centerWorld.y - app.view.height / 2 + y,
    app.view.zoom,
  );
}

function toScreen(latLng) {
  const centerWorld = adapter.latLngToWorld(app.view.center.lat, app.view.center.lng, app.view.zoom);
  const world = adapter.latLngToWorld(latLng.lat, latLng.lng, app.view.zoom);
  return {
    x: world.x - centerWorld.x + app.view.width / 2,
    y: world.y - centerWorld.y + app.view.height / 2,
  };
}

function totalDistance() {
  return app.state.segments.reduce((sum, segment) => sum + segmentDistance(segment), 0);
}

function segmentDistance(segment) {
  let distance = 0;
  for (let index = 1; index < segment.points.length; index += 1) {
    distance += haversine(segment.points[index - 1], segment.points[index]);
  }
  return distance;
}

function haversine(a, b) {
  const radius = 6371;
  const dLat = degToRad(b.lat - a.lat);
  const dLng = degToRad(b.lng - a.lng);
  const lat1 = degToRad(a.lat);
  const lat2 = degToRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.asin(Math.sqrt(h));
}

function pointToSegmentDistance(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  if (!length) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / length, 0, 1);
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function getActiveSegment() {
  return getSegment(app.state.activeSegmentId) || app.state.segments[0];
}

function getSegment(id) {
  return app.state.segments.find((segment) => segment.id === id);
}

function getSelectedPoint() {
  return getSegment(app.selected.segmentId).points.find((point) => point.id === app.selected.pointId);
}

function getSelectedWaypoint() {
  return app.state.waypoints.find((waypoint) => waypoint.id === app.selected.waypointId);
}

function isSelectedPoint(segmentId, pointId) {
  return app.selected?.type === "point" && app.selected.segmentId === segmentId && app.selected.pointId === pointId;
}

function isSelectedWaypoint(waypointId) {
  return app.selected?.type === "waypoint" && app.selected.waypointId === waypointId;
}

function shouldRenderWaypoint(waypoint) {
  if (waypoint.type === "warning" && !app.layers.warnings) return false;
  if (waypoint.photo && !app.layers.photos) return false;
  return true;
}

function uid(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}-${Date.now().toString(36)}`;
}

function labelTool(tool) {
  return { draw: "그리기", select: "편집", insert: "삽입", waypoint: "핀" }[tool] || tool;
}

function isMapSurface(target) {
  return target === mapEl || target === tileLayer || target === routeLayer;
}

function formatDistance(km) {
  return `${km.toFixed(1)} km`;
}

function degToRad(value) {
  return (value * Math.PI) / 180;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function svg(tag, attributes) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, value));
  return node;
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("visible"), 2200);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll('"', "&quot;");
}
