"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, FormEvent } from "react";
import { createMapAdapter } from "@/src/map";
import type { MapAdapter, MapRuntimeStatus, ProjectRenderInfo } from "@/src/map";
import { midpoint } from "@/src/domain/geometry";
import {
  projectDistance,
  selectedSegmentDistance,
  useEditorStore,
  waypointTypes,
} from "@/src/store/editor-store";
import type { Project, RoutePoint, RouteSegment, Selection, Waypoint, WaypointType } from "@/src/domain/types";

const center = { id: "center", lat: 37.5665, lng: 126.978 };
const toolLabels = {
  draw: "그리기",
  select: "편집",
  insert: "삽입",
  connect: "연결",
  waypoint: "핀",
} as const;
const toolIcons = {
  draw: "route",
  select: "pen",
  insert: "plusCircle",
  connect: "link",
  waypoint: "mapPin",
} as const;
const toolShortcuts = {
  draw: "D",
  select: "S",
  insert: "I",
  connect: "C",
  waypoint: "P",
} as const;
const editorTools = ["draw", "select", "insert", "connect", "waypoint"] as const;
const defaultRouteColor = "#e03024";
const routeColorOptions = ["#e03024", "#ff7a1a", "#f2c94c", "#2f80ed", "#8e44ad", "#23211d"] as const;
type IconName =
  | "route"
  | "move"
  | "pen"
  | "plusCircle"
  | "mapPin"
  | "search"
  | "save"
  | "upload"
  | "download"
  | "satellite"
  | "undo"
  | "redo"
  | "split"
  | "trash"
  | "layers"
  | "filePlus"
  | "reverse"
  | "link"
  | "chevronLeft"
  | "chevronRight";

export default function EditorPage() {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapCanvasRef = useRef<HTMLDivElement | null>(null);
  const adapterRef = useRef<MapAdapter | null>(null);
  const projectRef = useRef<Project | null>(null);
  const [fitRequest, setFitRequest] = useState(0);
  const [gpxMessage, setGpxMessage] = useState("");
  const [isDraggingGpx, setIsDraggingGpx] = useState(false);
  const [isDraggingGpxUpload, setIsDraggingGpxUpload] = useState(false);
  const [mapStatus, setMapStatus] = useState<MapRuntimeStatus>({
    state: "loading",
    message: "카카오맵 SDK 로딩 중",
  });
  const [isProjectBusy, setIsProjectBusy] = useState(false);
  const [projectMessage, setProjectMessage] = useState("");
  const [renderInfo, setRenderInfo] = useState<ProjectRenderInfo | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchMessage, setSearchMessage] = useState("");
  const [isCreatingProject, setIsCreatingProject] = useState(false);
  const [newProjectTitle, setNewProjectTitle] = useState("");
  const [connectionStart, setConnectionStart] = useState<{ segmentId: string; pointId: string } | null>(null);
  const [showPointHandles, setShowPointHandles] = useState(true);
  const [showRoutes, setShowRoutes] = useState(true);
  const [showWaypoints, setShowWaypoints] = useState(true);
  const [routeColor, setRouteColor] = useState(defaultRouteColor);
  const [newWaypointType, setNewWaypointType] = useState<WaypointType>("start");
  const [pointWaypointType, setPointWaypointType] = useState<WaypointType>("warning");
  const [pointWaypointTitle, setPointWaypointTitle] = useState("");
  const [pointWaypointDescription, setPointWaypointDescription] = useState("");
  const [segmentMenu, setSegmentMenu] = useState<{
    nearestPointId?: string;
    segmentId: string;
    point: Omit<RoutePoint, "id">;
    x: number;
    y: number;
  } | null>(null);
  const {
    project,
    projects,
    activeTool,
    mapMode,
    selected,
    history,
    future,
    setTool,
    setMapMode,
    select,
    newProject,
    updateTitle,
    addSegment,
    updateSegmentName,
    addPoint,
    insertPoint,
    movePoint,
    splitSegment,
    splitSegmentAtPoint,
    reverseSegment,
    connectSegmentsByEndpoints,
    deletePoint,
    deleteSegment,
    addWaypoint,
    updateWaypoint,
    deleteWaypoint,
    importGpxText,
    exportGpxText,
    saveProject,
    loadProjects,
    openProject,
    deleteProject,
    undo,
    redo,
  } = useEditorStore();

  const totalDistance = useMemo(() => projectDistance(project), [project]);
  const totalPointCount = useMemo(
    () => project.segments.reduce((sum, segment) => sum + segment.points.length, 0),
    [project.segments],
  );
  const selectedPoint = useMemo(() => getSelectedPoint(project.segments, selected), [project.segments, selected]);
  const selectedPointIndex = useMemo(
    () => getSelectedPointIndex(project.segments, selected),
    [project.segments, selected],
  );
  const selectedSegment = useMemo(
    () => getSelectedSegment(project.segments, selected),
    [project.segments, selected],
  );
  const selectedSegmentForActions = selected?.type === "segment" ? selectedSegment : undefined;
  const selectedWaypoint = useMemo(
    () => getSelectedWaypoint(project.waypoints, selected),
    [project.waypoints, selected],
  );
  const selectedPointWaypoint = useMemo(
    () => (selectedPoint ? waypointAtPoint(project.waypoints, selectedPoint) : undefined),
    [project.waypoints, selectedPoint],
  );
  const nextSelectedPoint = useMemo(
    () => (selectedSegment && selectedPointIndex >= 0 ? selectedSegment.points[selectedPointIndex + 1] : undefined),
    [selectedPointIndex, selectedSegment],
  );
  const savedProject = useMemo(
    () => projects.find((item) => item.id === project.id),
    [project.id, projects],
  );
  const saveState = useMemo(
    () => projectSaveState(project, savedProject?.updatedAt),
    [project, savedProject?.updatedAt],
  );

  useEffect(() => {
    if (activeTool !== "connect") setConnectionStart(null);
  }, [activeTool]);

  useEffect(() => {
    if (!segmentMenu) return;
    const close = () => setSegmentMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", close);
    };
  }, [segmentMenu]);

  useEffect(() => {
    if (!selectedPoint) return;
    const type = defaultWaypointTypeForPoint(selectedSegment, selectedPointIndex);
    setPointWaypointType(type);
    setPointWaypointTitle(defaultWaypointTitle(type, project.waypoints.length));
    setPointWaypointDescription("");
  }, [project.waypoints.length, selectedPoint?.id, selectedPointIndex, selectedSegment]);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    if (!mapCanvasRef.current || adapterRef.current) return;
    adapterRef.current = createMapAdapter();
    adapterRef.current.mount(mapCanvasRef.current);
    adapterRef.current.setView(center, 11);
    return () => adapterRef.current?.destroy();
  }, []);

  useEffect(() => {
    adapterRef.current?.setMode(mapMode);
  }, [mapMode]);

  useEffect(() => {
    adapterRef.current?.renderProject(project, {
      onMapStatus: setMapStatus,
      selectedSegmentId:
        selected?.type === "segment" || selected?.type === "point" ? selected.segmentId : undefined,
      selectedPointId: selected?.type === "point" ? selected.pointId : undefined,
      connectionStart: connectionStart || undefined,
      showConnectionEndpoints: activeTool === "connect",
      onRenderInfo: setRenderInfo,
      showPointHandles,
      routeColor,
      showRoutes,
      showWaypoints,
      onMapClick: (point) => {
        if (activeTool === "draw") addPoint(point);
        if (activeTool === "waypoint") {
          addWaypoint({
            ...point,
            description: "",
            title: defaultWaypointTitle(newWaypointType, project.waypoints.length),
            type: newWaypointType,
          });
        }
        if (activeTool === "select" && selected?.type === "point") {
          select(null);
        }
      },
      onPointClick: (segmentId, pointId) => {
        if (activeTool === "connect") {
          handleConnectionPointClick(segmentId, pointId);
          return;
        }
        select({ type: "point", segmentId, pointId });
      },
      onPointDragEnd: (segmentId, pointId, point) => movePoint(segmentId, pointId, point),
      onSegmentClick: (segmentId, point) => {
        setSegmentMenu(null);
        if (activeTool === "insert") {
          const segment = project.segments.find((item) => item.id === segmentId);
          const afterPointId = segment ? nearestSegmentStartPointId(segment, point) : undefined;
          if (afterPointId) insertPoint(segmentId, afterPointId, point);
          return;
        }
        select({ type: "segment", segmentId });
      },
      onSegmentContextMenu: (segmentId, point, screenPoint) => {
        const segment = project.segments.find((item) => item.id === segmentId);
        select({ type: "segment", segmentId });
        setSegmentMenu({
          nearestPointId: segment ? nearestSegmentPointId(segment, point) : undefined,
          segmentId,
          point,
          x: screenPoint.x,
          y: screenPoint.y,
        });
      },
      onWaypointClick: (waypointId) => select({ type: "waypoint", waypointId }),
      onWaypointDragEnd: (waypoint) => updateWaypoint(waypoint),
    });
  }, [
    activeTool,
    addPoint,
    addWaypoint,
    connectSegmentsByEndpoints,
    connectionStart,
    deletePoint,
    insertPoint,
    movePoint,
    newWaypointType,
    project,
    select,
    selected,
    selectedPointIndex,
    selectedSegment,
    setMapStatus,
    showPointHandles,
    routeColor,
    showRoutes,
    showWaypoints,
    splitSegment,
    splitSegmentAtPoint,
    updateWaypoint,
  ]);

  useEffect(() => {
    loadProjects().catch(() => setProjectMessage("저장된 프로젝트 목록을 불러오지 못했습니다."));
  }, [loadProjects]);

  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (!saveState.needsSave) return;
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [saveState.needsSave]);

  useEffect(() => {
    if (!fitRequest) return;
    if (projectRef.current) adapterRef.current?.fitProject(projectRef.current);
  }, [fitRequest]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target;
      const isTyping = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.shiftKey && event.key.toLowerCase() === "z") {
        event.preventDefault();
        redo();
      } else if (meta && event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
      } else if (meta && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!isProjectBusy) void handleSaveProject();
      } else if (event.key === "Delete" || event.key === "Backspace") {
        if (isTyping) return;
        if (!selected) return;
        event.preventDefault();
        deleteSelection(selected, { deletePoint, deleteSegment, deleteWaypoint, select });
      } else if (event.key === "Escape") {
        if (isTyping) return;
        event.preventDefault();
        select(null);
      } else if (!meta && !event.altKey && !event.shiftKey && !isTyping) {
        const tool = toolFromShortcut(event.key);
        if (!tool) return;
        event.preventDefault();
        setTool(tool);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deletePoint, deleteSegment, deleteWaypoint, isProjectBusy, redo, select, selected, setTool, undo]);

  async function handleImport(file: File) {
    setGpxMessage("GPX를 읽는 중...");
    try {
      const imported = importGpxText(await file.text());
      const pointCount = imported.segments.reduce((sum, segment) => sum + segment.points.length, 0);
      const skipped = imported.skippedPoints ? `, 제외 ${imported.skippedPoints.toLocaleString("ko-KR")}개` : "";
      setGpxMessage(
        `${file.name} 가져오기 완료: 구간 ${imported.segments.length.toLocaleString("ko-KR")}개, 포인트 ${pointCount.toLocaleString(
          "ko-KR",
        )}개, 웨이포인트 ${imported.waypoints.length.toLocaleString("ko-KR")}개${skipped}`,
      );
      setFitRequest((value) => value + 1);
    } catch (error) {
      setGpxMessage(error instanceof Error ? error.message : "GPX 파일을 가져오지 못했습니다.");
    }
  }

  function handleGpxFile(file: File | undefined) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".gpx")) {
      setGpxMessage("GPX 파일만 가져올 수 있습니다.");
      return;
    }
    if (!confirmDiscardUnsavedChanges(saveState)) return;
    void handleImport(file);
  }

  async function handleOpenProject(projectId: string) {
    if (projectId !== project.id && !confirmDiscardUnsavedChanges(saveState)) return;
    await runProjectTask("프로젝트를 열었습니다.", async () => {
      await openProject(projectId);
      setFitRequest((value) => value + 1);
    });
  }

  async function handleSaveProject() {
    await runProjectTask("프로젝트를 저장했습니다.", saveProject);
  }

  async function handleCreateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = newProjectTitle.trim();
    if (!title) {
      setProjectMessage("새 프로젝트 이름을 입력하세요.");
      return;
    }
    if (!confirmDiscardUnsavedChanges(saveState)) return;
    newProject(title);
    setNewProjectTitle("");
    setIsCreatingProject(false);
    await runProjectTask("새 프로젝트를 만들고 저장했습니다.", saveProject);
  }

  function handleConnectionPointClick(segmentId: string, pointId: string) {
    if (!isSegmentEndpoint(project.segments, segmentId, pointId)) {
      setProjectMessage("구간 연결은 시작점 또는 도착점만 선택할 수 있습니다.");
      return;
    }
    if (!connectionStart) {
      setConnectionStart({ segmentId, pointId });
      select({ type: "point", segmentId, pointId });
      setProjectMessage("연결할 다른 구간의 시작점 또는 도착점을 선택하세요.");
      return;
    }
    if (connectionStart.segmentId === segmentId) {
      setProjectMessage("같은 구간이 아닌 다른 구간의 끝점을 선택하세요.");
      return;
    }
    connectSegmentsByEndpoints(connectionStart.segmentId, connectionStart.pointId, segmentId, pointId);
    select({ type: "segment", segmentId: connectionStart.segmentId });
    setConnectionStart(null);
    setProjectMessage("구간을 연결했습니다.");
  }

  function handleCreateWaypointFromSelectedPoint() {
    if (!selectedPoint) return;
    addWaypoint({
      description: pointWaypointDescription.trim() || undefined,
      lat: selectedPoint.lat,
      lng: selectedPoint.lng,
      title: pointWaypointTitle.trim() || defaultWaypointTitle(pointWaypointType, project.waypoints.length),
      type: pointWaypointType,
    });
    setProjectMessage("선택한 포인트에 웨이포인트를 추가했습니다.");
  }

  function insertSegmentMenuPoint() {
    if (!segmentMenu) return;
    const segment = project.segments.find((item) => item.id === segmentMenu.segmentId);
    const afterPointId = segment ? nearestSegmentStartPointId(segment, segmentMenu.point) : undefined;
    if (afterPointId) insertPoint(segmentMenu.segmentId, afterPointId, segmentMenu.point);
    setSegmentMenu(null);
  }

  function splitSegmentFromMenu() {
    if (!segmentMenu) return;
    const segment = project.segments.find((item) => item.id === segmentMenu.segmentId);
    const afterPointId = segment ? nearestSegmentStartPointId(segment, segmentMenu.point) : undefined;
    if (afterPointId) splitSegmentAtPoint(segmentMenu.segmentId, afterPointId, segmentMenu.point);
    setSegmentMenu(null);
  }

  function addWaypointFromSegmentMenu() {
    if (!segmentMenu) return;
    addWaypoint({
      ...segmentMenu.point,
      description: "",
      title: defaultWaypointTitle("warning", project.waypoints.length),
      type: "warning",
    });
    setSegmentMenu(null);
  }

  function deletePointFromSegmentMenu() {
    if (!segmentMenu?.nearestPointId) return;
    deletePoint(segmentMenu.segmentId, segmentMenu.nearestPointId);
    select({ type: "segment", segmentId: segmentMenu.segmentId });
    setSegmentMenu(null);
  }

  async function handleDeleteProject(projectId: string) {
    const targetProject = projects.find((item) => item.id === projectId);
    if (!confirmDeleteProject(targetProject?.title || "선택한 프로젝트")) return;
    if (projectId === project.id && !confirmDiscardUnsavedChanges(saveState)) return;
    await runProjectTask("프로젝트를 삭제했습니다.", () => deleteProject(projectId));
  }

  async function runProjectTask(successMessage: string, task: () => Promise<void>) {
    setIsProjectBusy(true);
    setProjectMessage("처리 중...");
    try {
      await task();
      setProjectMessage(successMessage);
    } catch (error) {
      setProjectMessage(error instanceof Error ? error.message : "프로젝트 작업에 실패했습니다.");
    } finally {
      setIsProjectBusy(false);
    }
  }

  function handleExport() {
    if (!totalPointCount) {
      setGpxMessage("내보낼 코스 포인트가 없습니다.");
      return;
    }
    const blob = new Blob([exportGpxText("track")], { type: "application/gpx+xml" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${project.title.replace(/[^a-z0-9가-힣_-]+/gi, "-")}.gpx`;
    link.click();
    URL.revokeObjectURL(url);
    setGpxMessage("GPX를 내보냈습니다.");
  }

  async function handleAddressSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = searchQuery.trim();
    if (!query) return;
    setSearchMessage("검색 중...");
    try {
      await adapterRef.current?.searchAddress(query);
      setSearchMessage("지도를 검색 위치로 이동했습니다.");
    } catch (error) {
      setSearchMessage(error instanceof Error ? error.message : "검색에 실패했습니다.");
    }
  }

  function handleMapDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (event.dataTransfer.types.includes("Files")) {
      setIsDraggingGpx(true);
    }
  }

  function handleMapDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDraggingGpx(false);
    const files = Array.from(event.dataTransfer.files);
    const gpxFile = files.find((item) => item.name.toLowerCase().endsWith(".gpx"));
    if (!gpxFile && files.length) {
      setGpxMessage("GPX 파일만 가져올 수 있습니다.");
      return;
    }
    handleGpxFile(gpxFile);
  }

  function handleGpxUploadDragOver(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer.types.includes("Files")) {
      event.dataTransfer.dropEffect = "copy";
      setIsDraggingGpxUpload(true);
    }
  }

  function handleGpxUploadDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingGpxUpload(false);
    const files = Array.from(event.dataTransfer.files);
    const gpxFile = files.find((item) => item.name.toLowerCase().endsWith(".gpx"));
    if (!gpxFile && files.length) {
      setGpxMessage("GPX 파일만 가져올 수 있습니다.");
      return;
    }
    handleGpxFile(gpxFile);
  }

  return (
    <main className="grid h-screen min-h-[720px] grid-cols-[320px_minmax(560px,1fr)_340px] bg-paper text-ink">
      <aside className="overflow-y-auto border-r border-line bg-panel p-6">
        <p className="text-xs font-bold uppercase text-moss">Adventure Trail</p>
        <h1 className="mt-2 text-4xl font-semibold leading-none">Studio</h1>

        <section className="mt-8 border-t border-line pt-5">
          <div className="mb-3 flex items-center justify-between text-xs font-bold uppercase text-muted">
            <span>프로젝트</span>
            <span className={saveState.needsSave ? "text-[#a93f31]" : "text-moss"}>
              {saveState.label}
            </span>
          </div>
          <div className="grid gap-2">
            {projects.length ? (
              projects.map((item) => (
                <div
                  key={item.id}
                  className={`grid grid-cols-[1fr_36px] overflow-hidden rounded-md ${
                    project.id === item.id ? "bg-[#dfe8dc] ring-1 ring-moss" : "bg-[#f3eee4]"
                  }`}
                >
                  <button
                    className="px-3 py-2 text-left text-sm disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={isProjectBusy}
                    onClick={() => handleOpenProject(item.id)}
                  >
                    <span className="block font-bold">{item.title}</span>
                    <span className="block text-xs text-muted">
                      {formatDate(item.updatedAt)} · {projectSummary(item)}
                    </span>
                  </button>
                  <button
                    className="flex items-center justify-center text-[#a93f31] disabled:cursor-not-allowed disabled:opacity-50"
                    disabled={isProjectBusy}
                    title="프로젝트 삭제"
                    onClick={() => handleDeleteProject(item.id)}
                  >
                    <Icon name="trash" />
                  </button>
                </div>
              ))
            ) : (
              <p className="rounded-md bg-[#f3eee4] px-3 py-2 text-sm text-muted">
                저장된 프로젝트가 없습니다.
              </p>
            )}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              className="flex h-10 items-center justify-center gap-2 rounded-md bg-[#eee8dc] text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isProjectBusy}
              onClick={() => {
                setNewProjectTitle("");
                setIsCreatingProject(true);
              }}
            >
              <Icon name="filePlus" />
              새 프로젝트
            </button>
            <button
              className="flex h-10 items-center justify-center gap-2 rounded-md bg-moss text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isProjectBusy}
              onClick={handleSaveProject}
              title={saveState.needsSave ? "Ctrl/Cmd+S로 저장" : "저장된 상태입니다"}
            >
              <Icon name="save" />
              {saveState.buttonLabel}
            </button>
          </div>
          {isCreatingProject ? (
            <form className="mt-3 grid gap-2 rounded-md bg-[#f3eee4] p-3" onSubmit={handleCreateProject}>
              <label className="grid gap-2 text-xs font-bold uppercase text-muted">
                새 프로젝트 이름
                <input
                  autoFocus
                  className="h-10 rounded-md border border-line bg-[#f7f2e8] px-3 text-sm normal-case text-ink outline-none"
                  placeholder="예: 강원 동해안 투어"
                  value={newProjectTitle}
                  onChange={(event) => setNewProjectTitle(event.target.value)}
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  className="flex h-9 items-center justify-center gap-2 rounded-md bg-moss text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isProjectBusy}
                  type="submit"
                >
                  <Icon name="save" />
                  생성 및 저장
                </button>
                <button
                  className="h-9 rounded-md bg-[#eee8dc] text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isProjectBusy}
                  onClick={() => {
                    setIsCreatingProject(false);
                    setNewProjectTitle("");
                  }}
                  type="button"
                >
                  취소
                </button>
              </div>
            </form>
          ) : null}
          {projectMessage ? <p className="mt-2 text-xs text-muted">{projectMessage}</p> : null}
          <button
            className="mt-2 flex h-9 w-full items-center justify-center gap-2 rounded-md bg-[#eee8dc] text-sm font-bold"
            onClick={() => adapterRef.current?.fitProject(project)}
          >
            <Icon name="search" />
            전체 코스 보기
          </button>
        </section>

        <section className="mt-6 border-t border-line pt-5">
          <div className="mb-3 flex items-center justify-between text-xs font-bold uppercase text-muted">
            <span>레이어</span>
            <span>{mapMode === "satellite" ? "위성" : "일반"}</span>
          </div>
          <label className="flex h-9 items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={mapMode === "satellite"}
              onChange={(event) => setMapMode(event.target.checked ? "satellite" : "standard")}
            />
            <Icon name="satellite" />
            위성 지도
          </label>
          <label className="flex h-9 items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={showRoutes}
              onChange={(event) => setShowRoutes(event.target.checked)}
            />
            <Icon name="route" />
            코스 표시
          </label>
          <div className="mt-2 grid gap-2 rounded-md bg-[#f3eee4] p-3">
            <div className="flex items-center justify-between text-xs font-bold uppercase text-muted">
              <span>코스 색상</span>
              <span>{routeColor.toUpperCase()}</span>
            </div>
            <div className="grid grid-cols-6 items-center gap-2">
              {routeColorOptions.map((color) => (
                <button
                  key={color}
                  aria-label={`코스 색상 ${color}`}
                  className={`h-7 w-7 rounded-full border-2 transition ${
                    routeColor.toLowerCase() === color.toLowerCase()
                      ? "border-ink ring-2 ring-moss/30"
                      : "border-white hover:border-ink/50"
                  }`}
                  onClick={() => setRouteColor(color)}
                  style={{ backgroundColor: color }}
                  title={color}
                  type="button"
                />
              ))}
            </div>
          </div>
          <label className="flex h-9 items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={showPointHandles}
              disabled={!showRoutes}
              onChange={(event) => setShowPointHandles(event.target.checked)}
            />
            <Icon name="move" />
            포인트 핸들
          </label>
          <label className="flex h-9 items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={showWaypoints}
              onChange={(event) => setShowWaypoints(event.target.checked)}
            />
            <Icon name="mapPin" />
            웨이포인트 표시
          </label>
        </section>

        <section className="mt-6 border-t border-line pt-5">
          <div className="mb-3 flex items-center justify-between text-xs font-bold uppercase text-muted">
            <span>GPX</span>
            <span>가져오기 / 내보내기</span>
          </div>
          <label
            className={`flex min-h-20 cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed px-3 text-center text-sm transition ${
              isDraggingGpxUpload
                ? "border-moss bg-[#dfe8dc] text-moss ring-2 ring-moss/20"
                : "border-[#b9ad9a] bg-[#f6f0e5] text-muted"
            }`}
            onDragLeave={() => setIsDraggingGpxUpload(false)}
            onDragOver={handleGpxUploadDragOver}
            onDrop={handleGpxUploadDrop}
          >
            <Icon name="upload" />
            {isDraggingGpxUpload ? "여기에 GPX 파일 놓기" : "GPX 업로드"}
            <input
              className="hidden"
              type="file"
              accept=".gpx"
              onChange={(event) => {
                const file = event.target.files?.[0];
                handleGpxFile(file);
                event.currentTarget.value = "";
              }}
            />
          </label>
          {gpxMessage ? <p className="mt-2 text-xs text-muted">{gpxMessage}</p> : null}
          <div className="mt-2 grid gap-2">
            <button
              className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-moss text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!totalPointCount}
              onClick={handleExport}
            >
              <Icon name="download" />
              GPX 내보내기
            </button>
          </div>
        </section>

        <section className="mt-6 border-t border-line pt-5">
          <div className="mb-3 flex items-center justify-between text-xs font-bold uppercase text-muted">
            <span>웨이포인트</span>
            <span>{project.waypoints.length}</span>
          </div>
          <div className="grid max-h-56 gap-1 overflow-y-auto pr-1">
            {project.waypoints.length ? (
              project.waypoints.map((waypoint, index) => (
                <button
                  key={waypoint.id}
                  className={`grid grid-cols-[74px_minmax(0,1fr)] rounded-md px-3 py-2 text-left text-xs hover:bg-[#eee8dc] ${
                    selected?.type === "waypoint" && selected.waypointId === waypoint.id
                      ? "bg-[#dfe8dc] ring-1 ring-moss"
                      : "bg-[#f3eee4]"
                  }`}
                  onClick={() => select({ type: "waypoint", waypointId: waypoint.id })}
                >
                  <strong>핀 {index + 1}</strong>
                  <span className="min-w-0 truncate text-muted">
                    {waypoint.title} · {waypointTypeLabel(waypoint.type)}
                  </span>
                </button>
              ))
            ) : (
              <p className="rounded-md bg-[#f3eee4] px-3 py-2 text-sm text-muted">
                아직 웨이포인트가 없습니다.
              </p>
            )}
          </div>
        </section>
      </aside>

      <section className="relative overflow-hidden">
        <div
          ref={mapRef}
          className={`relative h-full w-full overflow-hidden ${mapCursorClass(activeTool)}`}
          onDragLeave={() => setIsDraggingGpx(false)}
          onDragOver={handleMapDragOver}
          onDrop={handleMapDrop}
        >
          <div ref={mapCanvasRef} className="absolute inset-0" />
          {isDraggingGpx ? (
            <div className="pointer-events-none absolute inset-5 z-10 grid place-items-center rounded-md border-2 border-dashed border-moss bg-panel/85 text-moss shadow">
              <div className="flex items-center gap-3 text-lg font-bold">
                <Icon name="upload" />
                GPX 파일 놓기
              </div>
            </div>
          ) : null}
        </div>
        <form
          className="absolute left-5 top-5 grid w-[360px] grid-cols-[1fr_76px] gap-2 rounded-md bg-panel/95 p-2 shadow"
          onSubmit={handleAddressSearch}
        >
          <input
            className="h-10 rounded-md border border-line bg-[#f7f2e8] px-3 text-sm outline-none"
            placeholder="주소 또는 장소 검색"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          <button className="flex h-10 items-center justify-center gap-1 rounded-md bg-moss text-sm font-bold text-white" type="submit">
            <Icon name="search" />
            검색
          </button>
          {searchMessage ? (
            <div className="col-span-2 px-1 text-xs text-muted">{searchMessage}</div>
          ) : null}
        </form>
        <div className="absolute left-5 top-24 grid gap-2">
          <button className="flex h-10 w-10 items-center justify-center rounded-md bg-panel/95 text-xl shadow disabled:opacity-40" onClick={undo} disabled={!history.length} title="실행 취소">
            <Icon name="undo" />
          </button>
          <button className="flex h-10 w-10 items-center justify-center rounded-md bg-panel/95 text-xl shadow disabled:opacity-40" onClick={redo} disabled={!future.length} title="다시 실행">
            <Icon name="redo" />
          </button>
        </div>
        <div className="absolute right-5 top-5 z-10 grid gap-2 rounded-md border border-white/20 bg-ink/95 p-2.5 shadow-[0_18px_45px_rgba(0,0,0,0.34)]">
          {editorTools.map((tool) => (
            <ToolButton
              key={tool}
              active={activeTool === tool}
              icon={toolIcons[tool]}
              label={toolLabels[tool]}
              shortcut={toolShortcuts[tool]}
              onClick={() => setTool(tool)}
            />
          ))}
          <div className="my-1 h-px bg-white/20" />
          <ToolButton
            disabled={!canReverseSegment(selectedSegmentForActions)}
            icon="reverse"
            label="역전"
            onClick={() => {
              if (selected?.type === "segment") reverseSegment(selected.segmentId);
            }}
          />
          <ToolButton
            disabled={!canSplitSegment(selectedSegmentForActions)}
            icon="split"
            label="나누기"
            onClick={() => {
              if (selected?.type !== "segment") return;
              const segment = project.segments.find((item) => item.id === selected.segmentId);
              const mid = segment?.points[Math.floor(segment.points.length / 2)];
              if (mid) splitSegment(segment.id, mid.id);
            }}
          />
          <ToolButton
            danger
            disabled={selected?.type !== "segment"}
            icon="trash"
            label="삭제"
            onClick={() => {
              if (selected?.type === "segment") deleteSegment(selected.segmentId);
            }}
          />
        </div>
        {activeTool === "waypoint" ? (
          <div className="absolute right-24 top-5 z-10 grid w-[188px] gap-2 rounded-md bg-panel/95 p-3 shadow">
            <label className="grid gap-2 text-xs font-bold uppercase text-muted" htmlFor="floating-waypoint-type">
              새 핀 유형
              <select
                id="floating-waypoint-type"
                className="h-9 rounded-md border border-line bg-[#f7f2e8] px-2 text-sm normal-case text-ink"
                value={newWaypointType}
                onChange={(event) => setNewWaypointType(event.target.value as WaypointType)}
              >
                {waypointTypes.map((type) => (
                  <option key={type} value={type}>
                    {waypointTypeLabel(type)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : null}
        {activeTool === "connect" ? (
          <div className="absolute right-24 top-5 z-10 w-[220px] rounded-md bg-panel/95 px-3 py-2 text-xs text-muted shadow">
            {connectionStart
              ? "두 번째 구간의 시작점 또는 도착점을 클릭하세요."
              : "먼저 연결할 구간의 시작점 또는 도착점을 클릭하세요."}
          </div>
        ) : null}
        {segmentMenu ? (
          <div
            className="fixed z-20 grid w-44 gap-1 rounded-md border border-white/15 bg-ink/95 p-1.5 text-sm text-paper shadow-[0_18px_45px_rgba(0,0,0,0.34)]"
            onClick={(event) => event.stopPropagation()}
            style={{ left: segmentMenu.x, top: segmentMenu.y }}
          >
            <button
              className="flex h-9 items-center gap-2 rounded px-2 text-left hover:bg-white/10"
              onClick={insertSegmentMenuPoint}
              type="button"
            >
              <Icon name="plusCircle" />
              포인트 추가
            </button>
            <button
              className="flex h-9 items-center gap-2 rounded px-2 text-left hover:bg-white/10"
              onClick={splitSegmentFromMenu}
              type="button"
            >
              <Icon name="split" />
              분리
            </button>
            <button
              className="flex h-9 items-center gap-2 rounded px-2 text-left hover:bg-white/10"
              onClick={addWaypointFromSegmentMenu}
              type="button"
            >
              <Icon name="mapPin" />
              웨이포인트 추가
            </button>
            {segmentMenu.nearestPointId ? (
              <button
                className="flex h-9 items-center gap-2 rounded px-2 text-left text-[#ffd7d0] hover:bg-white/10"
                onClick={deletePointFromSegmentMenu}
                type="button"
              >
                <Icon name="trash" />
                포인트 삭제
              </button>
            ) : null}
          </div>
        ) : null}
        {renderInfo && renderInfo.totalRoutePoints > renderInfo.renderedRoutePoints ? (
          <div className="absolute bottom-16 left-5 max-w-sm rounded-md bg-panel/95 px-3 py-2 text-xs text-muted shadow">
            대용량 경로 렌더링: {renderInfo.totalRoutePoints.toLocaleString("ko-KR")}개 포인트 중{" "}
            {renderInfo.renderedRoutePoints.toLocaleString("ko-KR")}개를 표시합니다.
          </div>
        ) : null}
        {mapStatus.state !== "ready" ? (
          <div
            className={`absolute bottom-16 right-5 max-w-sm rounded-md px-3 py-2 text-xs shadow ${
              mapStatus.state === "error"
                ? "bg-[#f4ded8] text-[#8f3528]"
                : "bg-panel/95 text-muted"
            }`}
          >
            {mapStatus.message}
          </div>
        ) : null}
      </section>

      <aside className="overflow-y-auto border-l border-line bg-panel p-6">
        <section className="border-t border-line pt-5">
          <div className="mb-3 flex items-center justify-between text-xs font-bold uppercase text-muted">
            <span>속성</span>
            <span>{selectionLabel(selected?.type)}</span>
          </div>
          <label className="grid gap-2 text-xs font-bold uppercase text-muted">
            프로젝트 이름
            <input
              className="h-10 rounded-md border border-line bg-[#f7f2e8] px-3 text-sm normal-case text-ink"
              value={project.title}
              onChange={(event) => updateTitle(event.target.value)}
            />
          </label>
          <div className="mt-4 grid grid-cols-2 gap-2 border-t border-line pt-4 text-sm">
            <MetaTile label="생성" value={formatDate(project.createdAt)} />
            <MetaTile label="수정" value={formatDate(project.updatedAt)} />
            <MetaTile label="구간" value={`${project.segments.length.toLocaleString("ko-KR")}개`} />
            <MetaTile label="포인트" value={`${totalPointCount.toLocaleString("ko-KR")}개`} />
            <MetaTile label="웨이포인트" value={`${project.waypoints.length.toLocaleString("ko-KR")}개`} />
            <MetaTile label="전체 거리" value={`${totalDistance.toFixed(1)} km`} />
          </div>
          {selected?.type === "segment" && selectedSegment ? (
            <div className="mt-4 grid gap-3 border-t border-line pt-4">
              <label className="grid gap-2 text-xs font-bold uppercase text-muted">
                구간 이름
                <input
                  className="h-10 rounded-md border border-line bg-[#f7f2e8] px-3 text-sm normal-case text-ink"
                  value={selectedSegment.name}
                  onChange={(event) => updateSegmentName(selectedSegment.id, event.target.value)}
                />
              </label>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-md bg-[#f3eee4] p-3">
                  <span className="block text-xs font-bold uppercase text-muted">포인트</span>
                  {selectedSegment.points.length}개
                </div>
                <div className="rounded-md bg-[#f3eee4] p-3">
                  <span className="block text-xs font-bold uppercase text-muted">거리</span>
                  {selectedSegmentDistance(project, selected).toFixed(1)} km
                </div>
              </div>
              {renderInfo && renderInfo.hiddenPointHandles > 0 ? (
                <p className="rounded-md bg-[#f3eee4] p-3 text-xs text-muted">
                  선택 구간의 편집 핸들은 성능을 위해{" "}
                  {renderInfo.renderedPointHandles.toLocaleString("ko-KR")}개만 표시됩니다.
                  세밀한 수정은 구간을 나누거나 지도를 확대해 주요 포인트를 조정하세요.
                </p>
              ) : null}
              {selectedSegment.points.length ? (
                <div className="grid gap-2">
                  <div className="flex items-center justify-between text-xs font-bold uppercase text-muted">
                    <span>포인트 목록</span>
                    <span>
                      {Math.min(selectedSegment.points.length, 12).toLocaleString("ko-KR")}
                      /{selectedSegment.points.length.toLocaleString("ko-KR")}
                    </span>
                  </div>
                  <div className="grid max-h-56 gap-1 overflow-y-auto pr-1">
                    {segmentPointRows(selectedSegment).map(({ index, point }) => (
                      <button
                        key={point.id}
                        className="grid grid-cols-[74px_minmax(0,1fr)] rounded-md bg-[#f3eee4] px-3 py-2 text-left text-xs hover:bg-[#eee8dc]"
                        onClick={() => select({ type: "point", segmentId: selectedSegment.id, pointId: point.id })}
                        title="포인트 속성 편집"
                      >
                        <strong>포인트 {index + 1}</strong>
                        <span className="min-w-0 truncate text-muted">
                          {formatCoordinate(point.lat)}, {formatCoordinate(point.lng)}
                        </span>
                      </button>
                    ))}
                  </div>
                  {selectedSegment.points.length > 12 ? (
                    <p className="text-xs text-muted">대용량 구간은 앞쪽 12개 포인트만 빠르게 선택합니다.</p>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          {selected?.type === "point" && selectedPoint ? (
            <div className="mt-4 grid gap-3 border-t border-line pt-4">
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <button
                  className="flex h-10 items-center justify-center gap-2 rounded-md bg-[#eee8dc] text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!selectedSegment || selectedPointIndex <= 0}
                  onClick={() => selectAdjacentPoint(selectedSegment, selectedPointIndex, -1, select)}
                  title="이전 포인트 선택"
                >
                  <Icon name="chevronLeft" />
                  이전
                </button>
                <span className="rounded-md bg-[#f3eee4] px-3 py-2 text-xs font-bold text-muted">
                  {selectedSegment && selectedPointIndex >= 0
                    ? `${selectedPointIndex + 1}/${selectedSegment.points.length}`
                    : "-"}
                </span>
                <button
                  className="flex h-10 items-center justify-center gap-2 rounded-md bg-[#eee8dc] text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!selectedSegment || selectedPointIndex >= selectedSegment.points.length - 1}
                  onClick={() => selectAdjacentPoint(selectedSegment, selectedPointIndex, 1, select)}
                  title="다음 포인트 선택"
                >
                  다음
                  <Icon name="chevronRight" />
                </button>
              </div>
              <label className="grid min-w-0 gap-2 text-xs font-bold uppercase text-muted">
                위도
                <input
                  className="h-10 w-full min-w-0 rounded-md border border-line bg-[#f7f2e8] px-3 text-sm normal-case text-ink"
                  type="number"
                  step="0.000001"
                  value={selectedPoint.lat}
                  onChange={(event) => {
                    const lat = latitudeFromInput(event.target.value);
                    if (lat === undefined) return;
                    movePoint(selected.segmentId, selected.pointId, {
                      lat,
                      lng: selectedPoint.lng,
                    });
                  }}
                />
              </label>
              <label className="grid min-w-0 gap-2 text-xs font-bold uppercase text-muted">
                경도
                <input
                  className="h-10 w-full min-w-0 rounded-md border border-line bg-[#f7f2e8] px-3 text-sm normal-case text-ink"
                  type="number"
                  step="0.000001"
                  value={selectedPoint.lng}
                  onChange={(event) => {
                    const lng = longitudeFromInput(event.target.value);
                    if (lng === undefined) return;
                    movePoint(selected.segmentId, selected.pointId, {
                      lat: selectedPoint.lat,
                      lng,
                    });
                  }}
                />
              </label>
              <div className="grid gap-3 rounded-md bg-[#f3eee4] p-3">
                <div className="flex items-center justify-between text-xs font-bold uppercase text-muted">
                  <span>웨이포인트 정보</span>
                  <span>{selectedPointWaypoint ? "등록됨" : "새로 추가"}</span>
                </div>
                <label className="grid min-w-0 gap-2 text-xs font-bold uppercase text-muted">
                  유형
                  <select
                    className="h-10 w-full min-w-0 rounded-md border border-line bg-[#f7f2e8] px-3 text-sm normal-case text-ink"
                    value={selectedPointWaypoint?.type || pointWaypointType}
                    onChange={(event) => {
                      const type = event.target.value as WaypointType;
                      if (selectedPointWaypoint) {
                        updateWaypoint({ ...selectedPointWaypoint, type });
                      } else {
                        setPointWaypointType(type);
                        setPointWaypointTitle(defaultWaypointTitle(type, project.waypoints.length));
                      }
                    }}
                  >
                    {waypointTypes.map((type) => (
                      <option key={type} value={type}>
                        {waypointTypeLabel(type)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid min-w-0 gap-2 text-xs font-bold uppercase text-muted">
                  제목
                  <input
                    className="h-10 w-full min-w-0 rounded-md border border-line bg-[#f7f2e8] px-3 text-sm normal-case text-ink"
                    value={selectedPointWaypoint?.title || pointWaypointTitle}
                    onChange={(event) => {
                      if (selectedPointWaypoint) {
                        updateWaypoint({ ...selectedPointWaypoint, title: event.target.value });
                      } else {
                        setPointWaypointTitle(event.target.value);
                      }
                    }}
                  />
                </label>
                <label className="grid min-w-0 gap-2 text-xs font-bold uppercase text-muted">
                  설명
                  <textarea
                    className="min-h-20 w-full min-w-0 rounded-md border border-line bg-[#f7f2e8] px-3 py-2 text-sm normal-case text-ink"
                    value={selectedPointWaypoint?.description || pointWaypointDescription}
                    onChange={(event) => {
                      if (selectedPointWaypoint) {
                        updateWaypoint({ ...selectedPointWaypoint, description: event.target.value });
                      } else {
                        setPointWaypointDescription(event.target.value);
                      }
                    }}
                  />
                </label>
                {selectedPointWaypoint ? (
                  <button
                    className="flex h-10 items-center justify-center gap-2 rounded-md bg-[#f4ded8] text-sm font-bold text-[#a93f31]"
                    onClick={() => deleteWaypoint(selectedPointWaypoint.id)}
                  >
                    <Icon name="trash" />
                    웨이포인트 삭제
                  </button>
                ) : (
                  <button
                    className="flex h-10 items-center justify-center gap-2 rounded-md bg-moss text-sm font-bold text-white"
                    onClick={handleCreateWaypointFromSelectedPoint}
                  >
                    <Icon name="mapPin" />
                    웨이포인트 추가
                  </button>
                )}
              </div>
              <button
                className="flex h-10 items-center justify-center gap-2 rounded-md bg-[#eee8dc] text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!nextSelectedPoint}
                onClick={() => {
                  if (!nextSelectedPoint) return;
                  insertPoint(selected.segmentId, selected.pointId, midpoint(selectedPoint, nextSelectedPoint));
                }}
                title={
                  nextSelectedPoint
                    ? "선택 포인트와 다음 포인트 사이에 중간 포인트를 추가합니다"
                    : "마지막 포인트 뒤에는 사이 포인트를 추가할 수 없습니다"
                }
              >
                <Icon name="plusCircle" />
                다음 포인트 사이에 삽입
              </button>
              <button
                className="flex h-10 items-center justify-center gap-2 rounded-md bg-[#eee8dc] text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!canSplitAtPoint(selectedSegment, selectedPointIndex)}
                onClick={() => {
                  splitSegment(selected.segmentId, selected.pointId);
                  select({ type: "segment", segmentId: selected.segmentId });
                }}
                title={
                  canSplitAtPoint(selectedSegment, selectedPointIndex)
                    ? "선택한 포인트에서 구간을 나눕니다"
                    : "구간의 시작점과 끝점에서는 나눌 수 없습니다"
                }
              >
                <Icon name="split" />
                선택 포인트에서 나누기
              </button>
              <button
                className="flex h-10 items-center justify-center gap-2 rounded-md bg-[#f4ded8] text-sm font-bold text-[#a93f31]"
                onClick={() => {
                  deletePoint(selected.segmentId, selected.pointId);
                  select({ type: "segment", segmentId: selected.segmentId });
                }}
              >
                <Icon name="trash" />
                포인트 삭제
              </button>
            </div>
          ) : null}
          {selected?.type === "waypoint" && selectedWaypoint ? (
            <div className="mt-4 grid gap-3 border-t border-line pt-4">
              <label className="grid gap-2 text-xs font-bold uppercase text-muted">
                제목
                <input
                  className="h-10 rounded-md border border-line bg-[#f7f2e8] px-3 text-sm normal-case text-ink"
                  value={selectedWaypoint.title}
                  onChange={(event) => updateWaypoint({ ...selectedWaypoint, title: event.target.value })}
                />
              </label>
              <label className="grid gap-2 text-xs font-bold uppercase text-muted">
                유형
                <select
                  className="h-10 rounded-md border border-line bg-[#f7f2e8] px-3 text-sm normal-case text-ink"
                  value={selectedWaypoint.type}
                  onChange={(event) =>
                    updateWaypoint({ ...selectedWaypoint, type: event.target.value as WaypointType })
                  }
                >
                  {waypointTypes.map((type) => (
                    <option key={type} value={type}>
                      {waypointTypeLabel(type)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-2 text-xs font-bold uppercase text-muted">
                설명
                <textarea
                  className="min-h-24 rounded-md border border-line bg-[#f7f2e8] px-3 py-2 text-sm normal-case text-ink"
                  value={selectedWaypoint.description || ""}
                  onChange={(event) =>
                    updateWaypoint({ ...selectedWaypoint, description: event.target.value })
                  }
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="grid min-w-0 gap-2 text-xs font-bold uppercase text-muted">
                  위도
                  <input
                    className="h-10 w-full min-w-0 rounded-md border border-line bg-[#f7f2e8] px-3 text-sm normal-case text-ink"
                    type="number"
                    step="0.000001"
                    value={selectedWaypoint.lat}
                    onChange={(event) => {
                      const lat = latitudeFromInput(event.target.value);
                      if (lat === undefined) return;
                      updateWaypoint({ ...selectedWaypoint, lat });
                    }}
                  />
                </label>
                <label className="grid min-w-0 gap-2 text-xs font-bold uppercase text-muted">
                  경도
                  <input
                    className="h-10 w-full min-w-0 rounded-md border border-line bg-[#f7f2e8] px-3 text-sm normal-case text-ink"
                    type="number"
                    step="0.000001"
                    value={selectedWaypoint.lng}
                    onChange={(event) => {
                      const lng = longitudeFromInput(event.target.value);
                      if (lng === undefined) return;
                      updateWaypoint({ ...selectedWaypoint, lng });
                    }}
                  />
                </label>
              </div>
              <button
                className="flex h-10 items-center justify-center gap-2 rounded-md bg-[#f4ded8] text-sm font-bold text-[#a93f31]"
                onClick={() => {
                  deleteWaypoint(selectedWaypoint.id);
                  select(null);
                }}
              >
                <Icon name="trash" />
                웨이포인트 삭제
              </button>
            </div>
          ) : null}
        </section>

        <section className="mt-6 border-t border-line pt-5">
          <div className="mb-3 flex items-center justify-between text-xs font-bold uppercase text-muted">
            <span>구간</span>
            <span>{project.segments.length}</span>
          </div>
          <button
            className="mb-3 flex h-10 w-full items-center justify-center gap-2 rounded-md bg-moss text-sm font-bold text-white"
            onClick={addSegment}
          >
            <Icon name="plusCircle" />
            새 구간
          </button>
          <div className="grid gap-2">
            {project.segments.map((segment) => (
              <button
                key={segment.id}
                className={`rounded-md px-3 py-2 text-left text-sm ${
                  selectedSegment?.id === segment.id ? "bg-[#dfe8dc] ring-1 ring-moss" : "bg-[#f3eee4]"
                }`}
                onClick={() => select({ type: "segment", segmentId: segment.id })}
              >
                <strong className="flex items-center gap-2">
                  <Icon name="layers" />
                  {segment.name}
                </strong>
                <span className="block text-xs text-muted">{segment.points.length}개 포인트</span>
              </button>
            ))}
          </div>
        </section>

      </aside>
    </main>
  );
}

function selectionLabel(type?: string): string {
  if (type === "segment") return "구간";
  if (type === "point") return "포인트";
  if (type === "waypoint") return "웨이포인트";
  return "없음";
}

function MetaTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-[#f3eee4] p-3">
      <span className="block text-xs font-bold uppercase text-muted">{label}</span>
      <span className="block truncate text-sm text-ink">{value}</span>
    </div>
  );
}

function ToolButton({
  active,
  danger,
  disabled,
  icon,
  label,
  onClick,
  shortcut,
}: {
  active?: boolean;
  danger?: boolean;
  disabled?: boolean;
  icon: IconName;
  label: string;
  onClick: () => void;
  shortcut?: string;
}) {
  const stateClass = disabled
    ? "cursor-not-allowed bg-[#2b2823] text-paper/35"
    : danger
      ? "bg-[#5a2924] text-[#ffd7d0] hover:bg-[#74342d]"
      : active
        ? "bg-moss text-white"
        : "bg-[#38342d] text-paper hover:bg-[#4a443b]";

  return (
    <button
      aria-label={label}
      aria-disabled={disabled}
      className={`group relative flex h-14 w-14 items-center justify-center rounded-md transition focus:outline-none focus:ring-2 focus:ring-[#d6a23a] focus:ring-offset-2 focus:ring-offset-ink ${
        stateClass
      }`}
      onClick={() => {
        if (!disabled) onClick();
      }}
      title={shortcut ? `${label} (${shortcut})` : label}
      type="button"
    >
      <Icon name={icon} className="h-6 w-6" />
      <span className="pointer-events-none absolute right-[calc(100%+10px)] top-1/2 whitespace-nowrap rounded-md bg-ink px-2.5 py-1.5 text-xs font-bold text-paper opacity-0 shadow transition -translate-y-1/2 group-hover:opacity-100 group-focus-visible:opacity-100">
        {label}
        {shortcut ? <span className="ml-1 font-normal text-[#d8d0c2]">{shortcut}</span> : null}
      </span>
    </button>
  );
}

function projectSummary(project: Project): string {
  const pointCount = project.segments.reduce((sum, segment) => sum + segment.points.length, 0);
  return `${projectDistance(project).toFixed(1)} km · ${pointCount.toLocaleString("ko-KR")}포인트`;
}

function waypointTypeLabel(type: WaypointType): string {
  return {
    start: "출발",
    finish: "도착",
    fuel: "주유",
    food: "식사",
    camp: "캠프",
    warning: "주의",
  }[type];
}

function defaultWaypointTitle(type: WaypointType, currentCount: number): string {
  if (type === "start") return "출발";
  if (type === "finish") return "도착";
  return `${waypointTypeLabel(type)} ${currentCount + 1}`;
}

function defaultWaypointTypeForPoint(segment: RouteSegment | undefined, pointIndex: number): WaypointType {
  if (!segment || pointIndex < 0) return "warning";
  if (pointIndex === 0) return "start";
  if (pointIndex === segment.points.length - 1) return "finish";
  return "warning";
}

function toolFromShortcut(key: string): keyof typeof toolLabels | undefined {
  const normalized = key.toLowerCase();
  if (normalized === "d") return "draw";
  if (normalized === "s") return "select";
  if (normalized === "i") return "insert";
  if (normalized === "c") return "connect";
  if (normalized === "p") return "waypoint";
  return undefined;
}

function mapCursorClass(tool: keyof typeof toolLabels): string {
  if (tool === "draw" || tool === "insert" || tool === "connect" || tool === "waypoint") return "cursor-crosshair";
  return "cursor-grab";
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatCoordinate(value: number): string {
  return value.toFixed(6);
}

function segmentPointRows(segment: RouteSegment): Array<{ index: number; point: RoutePoint }> {
  return segment.points.slice(0, 12).map((point, index) => ({ index, point }));
}

function projectSaveState(
  project: Project,
  savedUpdatedAt: string | undefined,
): { buttonLabel: string; label: string; needsSave: boolean } {
  if (!savedUpdatedAt && isBlankDraftProject(project)) {
    return { buttonLabel: "저장", label: "저장 전", needsSave: false };
  }
  if (!savedUpdatedAt) return { buttonLabel: "저장 필요", label: "저장 필요", needsSave: true };
  if (savedUpdatedAt !== project.updatedAt) {
    return { buttonLabel: "저장 필요", label: "저장 필요", needsSave: true };
  }
  return { buttonLabel: "저장됨", label: "저장됨", needsSave: false };
}

function confirmDiscardUnsavedChanges(saveState: { needsSave: boolean }): boolean {
  if (!saveState.needsSave) return true;
  return window.confirm("저장되지 않은 변경사항이 있습니다. 계속하면 현재 편집 내용이 사라질 수 있습니다.");
}

function confirmDeleteProject(title: string): boolean {
  return window.confirm(`"${title}" 프로젝트를 삭제할까요? 이 작업은 되돌릴 수 없습니다.`);
}

function isBlankDraftProject(project: Project): boolean {
  return (
    project.title === "무제 투어링 코스" &&
    project.waypoints.length === 0 &&
    project.segments.length === 1 &&
    project.segments[0].name === "구간 1" &&
    project.segments[0].points.length === 0
  );
}

function coordinateFromInput(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const coordinate = Number(value);
  return Number.isFinite(coordinate) ? coordinate : undefined;
}

function latitudeFromInput(value: string): number | undefined {
  const latitude = coordinateFromInput(value);
  return latitude !== undefined && latitude >= -90 && latitude <= 90 ? latitude : undefined;
}

function longitudeFromInput(value: string): number | undefined {
  const longitude = coordinateFromInput(value);
  return longitude !== undefined && longitude >= -180 && longitude <= 180 ? longitude : undefined;
}

function getSelectedPoint(segments: RouteSegment[], selected: Selection): RoutePoint | undefined {
  if (selected?.type !== "point") return undefined;
  return segments
    .find((segment) => segment.id === selected.segmentId)
    ?.points.find((point) => point.id === selected.pointId);
}

function getSelectedPointIndex(segments: RouteSegment[], selected: Selection): number {
  if (selected?.type !== "point") return -1;
  const segment = segments.find((item) => item.id === selected.segmentId);
  return segment?.points.findIndex((point) => point.id === selected.pointId) ?? -1;
}

function getSelectedSegment(segments: RouteSegment[], selected: Selection): RouteSegment | undefined {
  if (selected?.type !== "segment" && selected?.type !== "point") return undefined;
  return segments.find((segment) => segment.id === selected.segmentId);
}

function canSplitAtPoint(segment: RouteSegment | undefined, pointIndex: number): boolean {
  if (!segment) return false;
  return pointIndex > 0 && pointIndex < segment.points.length - 1;
}

function selectAdjacentPoint(
  segment: RouteSegment | undefined,
  pointIndex: number,
  direction: -1 | 1,
  select: (selection: Selection) => void,
): void {
  if (!segment) return;
  const point = segment.points[pointIndex + direction];
  if (!point) return;
  select({ type: "point", segmentId: segment.id, pointId: point.id });
}

function canSplitSegment(segment: RouteSegment | undefined): boolean {
  return Boolean(segment && segment.points.length >= 3);
}

function canReverseSegment(segment: RouteSegment | undefined): boolean {
  return Boolean(segment && segment.points.length >= 2);
}

function isSegmentEndpoint(segments: RouteSegment[], segmentId: string, pointId: string): boolean {
  const segment = segments.find((item) => item.id === segmentId);
  return Boolean(segment && (segment.points[0]?.id === pointId || segment.points.at(-1)?.id === pointId));
}

function getSelectedWaypoint(
  waypoints: Waypoint[],
  selected: Selection,
) {
  if (selected?.type !== "waypoint") return undefined;
  return waypoints.find((waypoint) => waypoint.id === selected.waypointId);
}

function waypointAtPoint(waypoints: Waypoint[], point: Pick<RoutePoint, "lat" | "lng">): Waypoint | undefined {
  return waypoints.find((waypoint) => waypoint.lat === point.lat && waypoint.lng === point.lng);
}

function selectionSummary(
  selected: Selection,
  segment: RouteSegment | undefined,
  pointIndex: number,
  waypoint: { title: string; type: WaypointType } | undefined,
): string {
  if (selected?.type === "point" && segment) {
    return `${segment.name} · 포인트 ${pointIndex + 1}/${segment.points.length}`;
  }
  if (selected?.type === "segment" && segment) {
    return `${segment.name} · ${segment.points.length.toLocaleString("ko-KR")}포인트`;
  }
  if (selected?.type === "waypoint" && waypoint) {
    return `${waypoint.title} · ${waypointTypeLabel(waypoint.type)}`;
  }
  return "선택 없음";
}

function deleteSelection(
  selected: Exclude<Selection, null>,
  actions: {
    deletePoint: (segmentId: string, pointId: string) => void;
    deleteSegment: (segmentId: string) => void;
    deleteWaypoint: (waypointId: string) => void;
    select: (selection: Selection) => void;
  },
) {
  if (selected.type === "point") {
    actions.deletePoint(selected.segmentId, selected.pointId);
    actions.select({ type: "segment", segmentId: selected.segmentId });
  }
  if (selected.type === "segment") {
    actions.deleteSegment(selected.segmentId);
  }
  if (selected.type === "waypoint") {
    actions.deleteWaypoint(selected.waypointId);
    actions.select(null);
  }
}

function nearestSegmentStartPointId(segment: RouteSegment, point: Omit<RoutePoint, "id">): string | undefined {
  if (segment.points.length < 2) return segment.points[0]?.id;
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < segment.points.length - 1; index += 1) {
    const distance = pointToSegmentDistance(point, segment.points[index], segment.points[index + 1]);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return segment.points[bestIndex]?.id;
}

function nearestSegmentPointId(segment: RouteSegment, point: Omit<RoutePoint, "id">): string | undefined {
  let bestPoint: RoutePoint | undefined;
  let bestDistance = Number.POSITIVE_INFINITY;
  segment.points.forEach((candidate) => {
    const distance = Math.hypot(candidate.lng - point.lng, candidate.lat - point.lat);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestPoint = candidate;
    }
  });
  return bestDistance <= 0.0005 ? bestPoint?.id : undefined;
}

function pointToSegmentDistance(
  point: Omit<RoutePoint, "id">,
  start: RoutePoint,
  end: RoutePoint,
): number {
  const dx = end.lng - start.lng;
  const dy = end.lat - start.lat;
  const length = dx * dx + dy * dy;
  if (!length) return Math.hypot(point.lng - start.lng, point.lat - start.lat);
  const t = Math.max(
    0,
    Math.min(1, ((point.lng - start.lng) * dx + (point.lat - start.lat) * dy) / length),
  );
  return Math.hypot(point.lng - (start.lng + t * dx), point.lat - (start.lat + t * dy));
}

function Icon({ className = "h-4 w-4", name }: { className?: string; name: IconName }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    strokeWidth: 2,
  };
  return (
    <svg aria-hidden="true" className={`${className} shrink-0`} viewBox="0 0 24 24" {...common}>
      {name === "route" ? (
        <path d="M5 19c4-6 10 0 14-6M5 19a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm14-8a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
      ) : null}
      {name === "move" ? (
        <path d="M12 3v18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12h18M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" />
      ) : null}
      {name === "pen" ? (
        <>
          <path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z" />
          <path d="m13.5 7.5 3 3M4 20l3.5-3.5" />
        </>
      ) : null}
      {name === "plusCircle" ? (
        <>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 8v8M8 12h8" />
        </>
      ) : null}
      {name === "mapPin" ? (
        <>
          <path d="M12 21s7-5 7-11a7 7 0 1 0-14 0c0 6 7 11 7 11Z" />
          <circle cx="12" cy="10" r="2" />
        </>
      ) : null}
      {name === "search" ? (
        <>
          <circle cx="11" cy="11" r="6" />
          <path d="m16 16 4 4" />
        </>
      ) : null}
      {name === "save" ? (
        <path d="M5 4h12l2 2v14H5V4Zm4 0v6h6V4M8 20v-6h8v6" />
      ) : null}
      {name === "upload" ? (
        <path d="M12 16V4M8 8l4-4 4 4M5 20h14" />
      ) : null}
      {name === "download" ? (
        <path d="M12 4v12M8 12l4 4 4-4M5 20h14" />
      ) : null}
      {name === "satellite" ? (
        <path d="m7 8 9 9M5 10l5-5 9 9-5 5-9-9ZM15 5l4-4M19 1l2 2M4 20a6 6 0 0 0 6-6" />
      ) : null}
      {name === "undo" ? (
        <path d="M9 7H4v5M4 12c2-4 6-6 10-5 3 1 5 3 6 6" />
      ) : null}
      {name === "redo" ? (
        <path d="M15 7h5v5M20 12c-2-4-6-6-10-5-3 1-5 3-6 6" />
      ) : null}
      {name === "split" ? (
        <>
          <circle cx="6" cy="7" r="2.4" />
          <circle cx="6" cy="17" r="2.4" />
          <path d="m8 8.5 11 7M8 15.5 19 8" />
          <path d="m14 12 5 3.5M14 12l5-4" />
        </>
      ) : null}
      {name === "trash" ? (
        <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
      ) : null}
      {name === "layers" ? (
        <path d="m12 3 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 16l9 5 9-5" />
      ) : null}
      {name === "filePlus" ? (
        <path d="M6 3h8l4 4v14H6V3ZM14 3v5h4M12 12v6M9 15h6" />
      ) : null}
      {name === "reverse" ? (
        <>
          <circle cx="6" cy="12" r="2" />
          <circle cx="18" cy="12" r="2" />
          <path d="M8 7c3-3 7-3 10 0M18 7h-4M18 7v4M16 17c-3 3-7 3-10 0M6 17h4M6 17v-4" />
        </>
      ) : null}
      {name === "link" ? (
        <path d="M9 7H7a5 5 0 0 0 0 10h2M15 7h2a5 5 0 0 1 0 10h-2M8 12h8" />
      ) : null}
      {name === "chevronLeft" ? <path d="m15 18-6-6 6-6" /> : null}
      {name === "chevronRight" ? <path d="m9 18 6-6-6-6" /> : null}
    </svg>
  );
}
