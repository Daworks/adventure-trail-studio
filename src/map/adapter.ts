import { lineString, simplify } from "@turf/turf";
import type { MapMode, Project, RoutePoint, RouteSegment, Waypoint, WaypointType } from "../domain/types";
import type { MapAdapter, MapProvider, MapRuntimeStatus, ProjectRenderCallbacks, ProjectRenderInfo } from "./types";

const MAX_VISIBLE_POINT_HANDLES = 360;
const SIMPLIFY_POINT_THRESHOLD = 1600;
const HANDLE_SIMPLIFY_TOLERANCE = 0.00018;
const KAKAO_API_KEY_STORAGE_KEY = "adventureTrailStudio.kakaoApiKey";
const OSM_TILE_SIZE = 256;

type KakaoNamespace = {
  maps: {
    LatLngBounds: new () => KakaoLatLngBounds;
    LatLng: new (lat: number, lng: number) => KakaoLatLng;
    Map: new (container: HTMLElement, options: { center: KakaoLatLng; level: number }) => KakaoMap;
    MarkerImage: new (src: string, size: KakaoSize, options?: { offset?: KakaoPoint }) => unknown;
    Marker: new (options: {
      clickable?: boolean;
      draggable?: boolean;
      image?: unknown;
      map: KakaoMap | null;
      position: KakaoLatLng;
      title?: string;
    }) => KakaoMarker;
    CustomOverlay: new (options: {
      content: HTMLElement;
      map: KakaoMap | null;
      position: KakaoLatLng;
      xAnchor?: number;
      yAnchor?: number;
    }) => KakaoOverlay;
    Polyline: new (options: {
      clickable?: boolean;
      map: KakaoMap | null;
      path: KakaoLatLng[];
      strokeColor: string;
      strokeOpacity: number;
      strokeStyle: string;
      strokeWeight: number;
    }) => KakaoPolyline;
    MapTypeId: {
      HYBRID: unknown;
      ROADMAP: unknown;
      SKYVIEW: unknown;
    };
    Point: new (x: number, y: number) => KakaoPoint;
    Size: new (width: number, height: number) => KakaoSize;
    event: {
      addListener(target: unknown, type: string, handler: (event: KakaoMouseEvent) => void): void;
    };
    services: {
      Geocoder: new () => {
        addressSearch(
          query: string,
          callback: (
            result: Array<{ address_name?: string; place_name?: string; x: string; y: string }>,
            status: unknown,
          ) => void,
        ): void;
      };
      Places: new () => {
        keywordSearch(
          query: string,
          callback: (
            result: Array<{ address_name?: string; place_name?: string; x: string; y: string }>,
            status: unknown,
          ) => void,
        ): void;
      };
      Status: {
        OK: unknown;
      };
    };
    load(callback: () => void): void;
  };
};

type KakaoLatLng = {
  getLat(): number;
  getLng(): number;
};
type KakaoLatLngBounds = {
  extend(latLng: KakaoLatLng): void;
};
type KakaoMouseEvent = {
  domEvent?: { clientX?: number; clientY?: number; preventDefault?: () => void };
  latLng?: KakaoLatLng;
  point?: { x: number; y: number };
};
type KakaoMap = {
  getCenter(): KakaoLatLng;
  setCenter(center: KakaoLatLng): void;
  setBounds(bounds: KakaoLatLngBounds, paddingTop?: number, paddingRight?: number, paddingBottom?: number, paddingLeft?: number): void;
  setLevel(level: number): void;
  setMapTypeId(typeId: unknown): void;
};
type KakaoPoint = unknown;
type KakaoSize = unknown;
type KakaoPolyline = { setMap(map: KakaoMap | null): void };
type KakaoMarker = {
  getPosition(): KakaoLatLng;
  setMap(map: KakaoMap | null): void;
};
type KakaoOverlay = {
  setMap(map: KakaoMap | null): void;
};
type PolylineEntry = {
  polyline: KakaoPolyline;
  signature: string;
};
type MarkerEntry = {
  marker: KakaoMarker;
  signature: string;
};
type FallbackPointerTarget =
  | { kind: "pan" }
  | { kind: "segment"; segmentId: string }
  | { kind: "point"; pointId: string; segmentId: string }
  | { kind: "waypoint"; waypointId: string };
type FallbackPointerState = FallbackPointerTarget & {
  id: number;
  moved: boolean;
  originX: number;
  originY: number;
  startX: number;
  startY: number;
};

declare global {
  interface Window {
    __tourMapKakaoPromise?: Promise<KakaoNamespace>;
    __tourMapKakaoPromiseKey?: string;
    kakao?: KakaoNamespace;
  }
}

export function createKakaoMapAdapter(): MapAdapter {
  return new KakaoMapAdapter();
}

class KakaoMapAdapter implements MapAdapter {
  private center: RoutePoint = { id: "center", lat: 37.5665, lng: 126.978 };
  private container?: HTMLElement;
  private fallbackMessage = "카카오맵 SDK 로딩 중";
  private fallbackPan = { x: 0, y: 0 };
  private fallbackPointer?: FallbackPointerState;
  private kakao?: KakaoNamespace;
  private map?: KakaoMap;
  private markers = new Map<string, MarkerEntry>();
  private mode: MapMode = "standard";
  private pendingCallbacks: ProjectRenderCallbacks = {};
  private pendingProject?: Project;
  private pointActionOverlay?: { overlay?: KakaoOverlay; element?: HTMLElement; signature: string };
  private polylines = new Map<string, PolylineEntry>();
  private provider: MapProvider = "kakao";
  private zoom = 11;

  mount(container: HTMLElement): void {
    this.container = container;
    this.notifyMapStatus({ state: "loading", provider: this.provider, message: "카카오맵 SDK 로딩 중" });
    this.renderFallback("카카오맵 SDK 로딩 중");
    void this.initializeKakaoMap(false);
  }

  async updateKakaoApiKey(key: string): Promise<void> {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      throw new Error("카카오 JavaScript 키를 입력하세요.");
    }
    localStorage.setItem(KAKAO_API_KEY_STORAGE_KEY, normalizedKey);
    resetKakaoSdkLoader();
    this.provider = "kakao";
    this.notifyMapStatus({ state: "loading", provider: this.provider, message: "카카오맵 SDK 재연결 중" });
    this.renderFallback("카카오맵 SDK 재연결 중");
    await this.initializeKakaoMap(true);
  }

  private async initializeKakaoMap(throwOnFailure: boolean): Promise<void> {
    const container = this.container;
    if (!container) return;
    try {
      const kakao = await loadKakaoSdk();
      this.kakao = kakao;
      this.unbindFallbackInteractions();
      container.innerHTML = "";
      this.map = new kakao.maps.Map(container, {
        center: new kakao.maps.LatLng(this.center.lat, this.center.lng),
        level: zoomToKakaoLevel(this.zoom),
      });
      kakao.maps.event.addListener(this.map, "dragend", () => {
        if (!this.map) return;
        this.center = { id: "kakao-center", ...pointFromLatLng(this.map.getCenter()) };
        this.updatePanDataset();
      });
      kakao.maps.event.addListener(this.map, "click", (event) => {
        if (!event.latLng) return;
        this.pendingCallbacks.onMapClick?.(pointFromLatLng(event.latLng));
      });
      kakao.maps.event.addListener(this.map, "rightclick", (event: KakaoMouseEvent) => {
        event.domEvent?.preventDefault?.();
        if (!event.latLng || !this.pendingProject) return;
        const point = pointFromLatLng(event.latLng);
        const segmentId = nearestContextSegmentId(this.pendingProject, point);
        if (!segmentId) return;
        this.pendingCallbacks.onSegmentContextMenu?.(segmentId, point, this.screenPointFromKakaoEvent(event));
      });
      this.applyMode();
      this.notifyMapStatus({ state: "ready", provider: this.provider, message: "카카오맵 연결됨" });
      this.renderPendingProject();
    } catch (error) {
      const message = mapLoadErrorMessage(error);
      this.map = undefined;
      this.kakao = undefined;
      this.notifyMapStatus({ state: "fallback", provider: "osm", message, needsApiKey: true });
      this.renderFallback(message);
      if (throwOnFailure) throw new Error(message);
    }
  }

  setMode(mode: MapMode): void {
    this.mode = mode;
    if (this.container) this.container.dataset.mode = mode;
    this.applyMode();
    if (!this.map) this.renderFallback(this.fallbackMessage);
  }

  setProvider(provider: MapProvider): void {
    this.provider = provider;
    if (provider === "osm") {
      this.clearProjectObjects();
      this.map = undefined;
      this.kakao = undefined;
      this.notifyMapStatus({ state: "fallback", provider, message: "OpenStreetMap을 사용 중입니다." });
      this.renderFallback("OpenStreetMap을 사용 중입니다.");
      return;
    }
    this.notifyMapStatus({ state: "loading", provider, message: "카카오맵 SDK 연결 중" });
    this.renderFallback("카카오맵 SDK 연결 중");
    void this.initializeKakaoMap(false);
  }

  setView(center: RoutePoint, zoom: number): void {
    this.center = center;
    this.zoom = zoom;
    if (!this.map || !this.kakao) {
      this.fallbackPan = { x: 0, y: 0 };
      this.renderFallback(this.fallbackMessage || "지도 준비 중");
      return;
    }
    this.map.setCenter(new this.kakao.maps.LatLng(center.lat, center.lng));
    this.map.setLevel(zoomToKakaoLevel(zoom));
    this.updatePanDataset();
  }

  renderProject(project: Project, callbacks: ProjectRenderCallbacks): void {
    this.pendingProject = project;
    this.pendingCallbacks = callbacks;
    this.renderPendingProject();
  }

  async searchAddress(query: string): Promise<RoutePoint> {
    if (this.provider === "osm") {
      throw new Error("주소 검색은 카카오맵 모드에서 사용할 수 있습니다.");
    }
    let kakao: KakaoNamespace;
    try {
      kakao = this.kakao ?? (await loadKakaoSdk());
    } catch (error) {
      throw new Error(searchLoadErrorMessage(error));
    }
    this.kakao = kakao;
    return new Promise((resolve, reject) => {
      const geocoder = new kakao.maps.services.Geocoder();
      geocoder.addressSearch(query, (result, status) => {
        if (status === kakao.maps.services.Status.OK && result[0]) {
          const point = pointFromSearchResult(result[0]);
          this.setView(point, 15);
          resolve(point);
          return;
        }
        const places = new kakao.maps.services.Places();
        places.keywordSearch(query, (keywordResult, keywordStatus) => {
          if (keywordStatus !== kakao.maps.services.Status.OK || !keywordResult[0]) {
            reject(new Error("주소 또는 장소를 찾지 못했습니다."));
            return;
          }
          const point = pointFromSearchResult(keywordResult[0]);
          this.setView(point, 15);
          resolve(point);
        });
      });
    });
  }

  destroy(): void {
    this.clearProjectObjects();
    if (this.container) this.container.innerHTML = "";
  }

  fitProject(project: Project): void {
    const points = projectBoundsPoints(project);
    if (!points.length) return;
    if (!this.map || !this.kakao) {
      this.center = { id: "fallback-center", ...averagePoint(points) };
      this.fallbackPan = { x: 0, y: 0 };
      this.renderFallback(this.fallbackMessage);
      return;
    }
    if (points.length === 1) {
      this.setView({ id: "project-center", ...points[0] }, 15);
      return;
    }
    const bounds = new this.kakao.maps.LatLngBounds();
    points.forEach((point) => bounds.extend(new this.kakao!.maps.LatLng(point.lat, point.lng)));
    this.map.setBounds(bounds, 80, 80, 80, 80);
  }

  private applyMode(): void {
    if (!this.map || !this.kakao) return;
    this.map.setMapTypeId(
      this.mode === "satellite" ? this.kakao.maps.MapTypeId.HYBRID : this.kakao.maps.MapTypeId.ROADMAP,
    );
  }

  private clearProjectObjects(): void {
    this.polylines.forEach((entry) => entry.polyline.setMap(null));
    this.markers.forEach((entry) => entry.marker.setMap(null));
    this.clearPointActionOverlay();
    this.polylines.clear();
    this.markers.clear();
  }

  private notifyMapStatus(status: MapRuntimeStatus): void {
    this.pendingCallbacks.onMapStatus?.(status);
  }

  private renderPendingProject(): void {
    if (!this.pendingProject) return;
    if (!this.map || !this.kakao || this.provider === "osm") {
      this.renderFallback(this.fallbackMessage);
      return;
    }
    const info = computeProjectRenderInfo(this.pendingProject, this.pendingCallbacks);

    const showRoutes = this.pendingCallbacks.showRoutes ?? true;
    const showWaypoints = this.pendingCallbacks.showWaypoints ?? true;
    const showPointHandles = this.pendingCallbacks.showPointHandles ?? true;
    const desiredPolylineKeys = new Set<string>();
    const desiredMarkerKeys = new Set<string>();

    if (showRoutes) {
      this.pendingProject.segments.forEach((segment) => {
        if (segment.points.length >= 2) {
          const visiblePoints = visibleRoutePoints(segment.points);
          desiredPolylineKeys.add(segment.id);
          this.renderSegment(segment, visiblePoints);
        }
        const handlePoints =
          showPointHandles && segment.id === this.pendingCallbacks.selectedSegmentId
            ? visibleHandlePointsWithSelection(segment, this.pendingCallbacks.selectedPointId)
            : [];
        handlePoints.forEach((point) => {
          const key = pointMarkerKey(segment.id, point.id);
          desiredMarkerKeys.add(key);
          this.renderPointMarker(segment.id, point, key);
        });
      });
      const endpoints = this.pendingCallbacks.showConnectionEndpoints
        ? segmentEndpointMarkers(this.pendingProject)
        : routeEndpointMarkers(this.pendingProject);
      endpoints.forEach((endpoint) => {
        const key = routeEndpointMarkerKey(endpoint.kind, endpoint.segmentId);
        desiredMarkerKeys.add(key);
        this.renderRouteEndpointMarker(endpoint, key, isConnectionStart(endpoint, this.pendingCallbacks.connectionStart));
      });
    }
    if (showWaypoints) {
      this.pendingProject.waypoints.forEach((waypoint) => {
        const key = waypointMarkerKey(waypoint.id);
        desiredMarkerKeys.add(key);
        this.renderWaypointMarker(waypoint, key);
      });
    }
    this.removeStalePolylines(desiredPolylineKeys);
    this.removeStaleMarkers(desiredMarkerKeys);
    this.clearPointActionOverlay();
    this.pendingCallbacks.onRenderInfo?.(info);
  }

  private renderSegment(segment: RouteSegment, visiblePoints: RoutePoint[]): void {
    if (!this.map || !this.kakao) return;
    const routeColor = this.pendingCallbacks.routeColor || DEFAULT_ROUTE_COLOR;
    const isSelected = this.pendingCallbacks.selectedSegmentId === segment.id;
    const signature = segmentSignature(segment, visiblePoints, isSelected, routeColor);
    const current = this.polylines.get(segment.id);
    if (current?.signature === signature) return;
    current?.polyline.setMap(null);
    const polyline = new this.kakao.maps.Polyline({
      clickable: true,
      map: this.map,
      path: visiblePoints.map((point) => new this.kakao!.maps.LatLng(point.lat, point.lng)),
      strokeColor: routeColor,
      strokeOpacity: 0.95,
      strokeStyle: "solid",
      strokeWeight: isSelected ? 7 : 5,
    });
    this.kakao.maps.event.addListener(polyline, "click", (event) => {
      if (!event.latLng) return;
      this.pendingCallbacks.onSegmentClick?.(segment.id, pointFromLatLng(event.latLng));
    });
    this.kakao.maps.event.addListener(polyline, "rightclick", (event: KakaoMouseEvent) => {
      event.domEvent?.preventDefault?.();
      if (!event.latLng) return;
      this.pendingCallbacks.onSegmentContextMenu?.(
        segment.id,
        pointFromLatLng(event.latLng),
        this.screenPointFromKakaoEvent(event),
      );
    });
    this.polylines.set(segment.id, { polyline, signature });
  }

  private renderPointMarker(segmentId: string, point: RoutePoint, key: string): void {
    if (!this.map || !this.kakao) return;
    const signature = pointSignature(point);
    const current = this.markers.get(key);
    if (current?.signature === signature) return;
    current?.marker.setMap(null);
    const marker = new this.kakao.maps.Marker({
      clickable: true,
      draggable: true,
      image: pointMarkerImage(this.kakao),
      map: this.map,
      position: new this.kakao.maps.LatLng(point.lat, point.lng),
      title: "코스 포인트",
    });
    this.kakao.maps.event.addListener(marker, "click", () => {
      this.pendingCallbacks.onPointClick?.(segmentId, point.id);
    });
    this.kakao.maps.event.addListener(marker, "dragend", () => {
      this.pendingCallbacks.onPointDragEnd?.(segmentId, point.id, pointFromLatLng(marker.getPosition()));
    });
    this.markers.set(key, { marker, signature });
  }

  private renderRouteEndpointMarker(
    endpoint: { kind: "start" | "finish"; point: RoutePoint; segmentId: string },
    key: string,
    active: boolean,
  ): void {
    if (!this.map || !this.kakao) return;
    const signature = routeEndpointSignature(endpoint, active);
    const current = this.markers.get(key);
    if (current?.signature === signature) return;
    current?.marker.setMap(null);
    const marker = new this.kakao.maps.Marker({
      clickable: true,
      image: routeEndpointMarkerImage(this.kakao, endpoint.kind, active),
      map: this.map,
      position: new this.kakao.maps.LatLng(endpoint.point.lat, endpoint.point.lng),
      title: endpoint.kind === "start" ? "코스 출발점" : "코스 종료지점",
    });
    this.kakao.maps.event.addListener(marker, "click", () => {
      this.pendingCallbacks.onPointClick?.(endpoint.segmentId, endpoint.point.id);
    });
    this.markers.set(key, { marker, signature });
  }

  private renderWaypointMarker(waypoint: Waypoint, key: string): void {
    if (!this.map || !this.kakao) return;
    const signature = waypointSignature(waypoint);
    const current = this.markers.get(key);
    if (current?.signature === signature) return;
    current?.marker.setMap(null);
    const marker = new this.kakao.maps.Marker({
      clickable: true,
      draggable: true,
      image: waypointMarkerImage(this.kakao, waypoint.type),
      map: this.map,
      position: new this.kakao.maps.LatLng(waypoint.lat, waypoint.lng),
      title: waypoint.title,
    });
    this.kakao.maps.event.addListener(marker, "click", () => {
      this.pendingCallbacks.onWaypointClick?.(waypoint.id);
    });
    this.kakao.maps.event.addListener(marker, "dragend", () => {
      this.pendingCallbacks.onWaypointDragEnd?.({
        ...waypoint,
        ...pointFromLatLng(marker.getPosition()),
      });
    });
    this.markers.set(key, { marker, signature });
  }

  private removeStalePolylines(desiredKeys: Set<string>): void {
    this.polylines.forEach((entry, key) => {
      if (desiredKeys.has(key)) return;
      entry.polyline.setMap(null);
      this.polylines.delete(key);
    });
  }

  private removeStaleMarkers(desiredKeys: Set<string>): void {
    this.markers.forEach((entry, key) => {
      if (desiredKeys.has(key)) return;
      entry.marker.setMap(null);
      this.markers.delete(key);
    });
  }

  private clearPointActionOverlay(): void {
    this.pointActionOverlay?.overlay?.setMap(null);
    this.pointActionOverlay?.element?.remove();
    this.pointActionOverlay = undefined;
  }

  private renderFallback(message: string): void {
    if (!this.container) return;
    this.fallbackMessage = message;
    const viewport = fallbackViewport(this.container, this.center, this.zoom, this.fallbackPan);
    const tiles = osmTiles(viewport, this.mode);
    const fallback = fallbackProjectSvg(this.pendingProject, this.pendingCallbacks, viewport);
    if (this.pendingProject) {
      this.pendingCallbacks.onRenderInfo?.(computeProjectRenderInfo(this.pendingProject, this.pendingCallbacks));
    }
    this.container.dataset.mode = this.mode;
    this.container.style.background = "#d7d2c8";
    this.container.style.cursor = "grab";
    this.updatePanDataset();
    this.container.innerHTML = `
      <div data-osm-tile-layer class="absolute inset-0 overflow-hidden bg-[#d7d2c8]">
        ${tiles}
      </div>
      <svg class="absolute inset-0 h-full w-full" width="${viewport.width}" height="${viewport.height}" viewBox="0 0 ${viewport.width} ${viewport.height}" preserveAspectRatio="none">
        <g data-fallback-layer>${fallback}</g>
      </svg>
      <div class="absolute left-5 top-5 max-w-md rounded-md bg-panel/95 px-3 py-2 text-xs text-muted shadow-sm">${escapeHtml(message)} OpenStreetMap fallback으로 전환했습니다.</div>
      <div class="absolute bottom-5 left-5 rounded-md bg-panel/95 px-3 py-2 text-xs text-muted shadow-sm">© OpenStreetMap contributors</div>
	    `;
	    this.bindFallbackInteractions();
	  }

  private bindFallbackInteractions(): void {
    if (!this.container) return;
    const start = (id: number, targetElement: EventTarget | null, clientX: number, clientY: number): void => {
      if (!this.container) return;
      const target = fallbackPointerTarget(targetElement);
      this.container!.style.cursor =
        target.kind === "point" || target.kind === "waypoint" ? "move" : "grabbing";
      this.fallbackPointer = {
        ...target,
        id,
        moved: false,
        originX: this.fallbackPan.x,
        originY: this.fallbackPan.y,
        startX: clientX,
        startY: clientY,
      };
    };
    const move = (id: number, clientX: number, clientY: number): void => {
      const pointer = this.fallbackPointer;
      if (!pointer || pointer.id !== id || !this.container) return;
      const dx = clientX - pointer.startX;
      const dy = clientY - pointer.startY;
      pointer.moved = pointer.moved || Math.hypot(dx, dy) > 4;
      if (pointer.kind === "point" || pointer.kind === "waypoint") return;
      this.fallbackPan = { x: pointer.originX + dx, y: pointer.originY + dy };
      this.updatePanDataset();
      this.renderFallback(this.fallbackMessage);
    };
    const end = (id: number, event: MouseEvent | PointerEvent): void => {
      const pointer = this.fallbackPointer;
      if (!pointer || pointer.id !== id) return;
      this.container!.style.cursor = "grab";
      this.fallbackPointer = undefined;
      if (pointer.kind === "point") {
        if (pointer.moved) {
          this.pendingCallbacks.onPointDragEnd?.(
            pointer.segmentId,
            pointer.pointId,
            this.fallbackPointFromPointer(event),
          );
        } else {
          this.pendingCallbacks.onPointClick?.(pointer.segmentId, pointer.pointId);
        }
        return;
      }
      if (pointer.kind === "waypoint") {
        if (pointer.moved) {
          const waypoint = this.pendingProject?.waypoints.find((item) => item.id === pointer.waypointId);
          if (waypoint) {
            this.pendingCallbacks.onWaypointDragEnd?.({
              ...waypoint,
              ...this.fallbackPointFromPointer(event),
            });
          }
        } else {
          this.pendingCallbacks.onWaypointClick?.(pointer.waypointId);
        }
        return;
      }
      if (pointer.kind === "segment" && !pointer.moved) {
        this.pendingCallbacks.onSegmentClick?.(pointer.segmentId, this.fallbackPointFromPointer(event));
        return;
      }
      if (pointer.kind === "pan" && !pointer.moved) {
        this.pendingCallbacks.onMapClick?.(this.fallbackPointFromPointer(event));
      }
    };
    this.container.onpointerdown = (event) => {
      if (event.button !== 0) return;
      try {
        this.container?.setPointerCapture(event.pointerId);
      } catch {
        // Synthetic smoke events do not always have an active browser pointer to capture.
      }
      start(event.pointerId, event.target, event.clientX, event.clientY);
    };
    this.container.onpointermove = (event) => move(event.pointerId, event.clientX, event.clientY);
    this.container.onpointerup = (event) => end(event.pointerId, event);
    this.container.onpointercancel = () => {
      this.container!.style.cursor = "grab";
      this.fallbackPointer = undefined;
    };
    this.container.oncontextmenu = (event) => {
      const target = fallbackPointerTarget(event.target);
      if (target.kind !== "segment") return;
      event.preventDefault();
      this.pendingCallbacks.onSegmentContextMenu?.(
        target.segmentId,
        this.fallbackPointFromPointer(event),
        { x: event.clientX, y: event.clientY },
      );
    };
    this.container.onmousedown = (event) => {
      if (event.button !== 0) return;
      start(-1, event.target, event.clientX, event.clientY);
    };
    this.container.onmousemove = (event) => move(-1, event.clientX, event.clientY);
    this.container.onmouseup = (event) => end(-1, event);
  }

  private unbindFallbackInteractions(): void {
    if (!this.container) return;
    this.container.onpointerdown = null;
    this.container.onpointermove = null;
    this.container.onpointerup = null;
    this.container.onpointercancel = null;
    this.container.oncontextmenu = null;
    this.container.onmousedown = null;
    this.container.onmousemove = null;
    this.container.onmouseup = null;
    this.fallbackPointer = undefined;
    this.container.style.cursor = "";
  }

  private fallbackPointFromPointer(event: MouseEvent): Omit<RoutePoint, "id"> {
    const rect = this.container!.getBoundingClientRect();
    const viewport = fallbackViewport(this.container!, this.center, this.zoom, this.fallbackPan);
    const x = viewport.topLeft.x + event.clientX - rect.left;
    const y = viewport.topLeft.y + event.clientY - rect.top;
    return worldToLatLng(x, y, viewport.zoom);
  }

  private screenPointFromKakaoEvent(event: KakaoMouseEvent): { x: number; y: number } {
    if (typeof event.domEvent?.clientX === "number" && typeof event.domEvent.clientY === "number") {
      return { x: event.domEvent.clientX, y: event.domEvent.clientY };
    }
    if (event.point && this.container) {
      const rect = this.container.getBoundingClientRect();
      return { x: rect.left + event.point.x, y: rect.top + event.point.y };
    }
    return { x: 0, y: 0 };
  }

  private updatePanDataset(): void {
    if (!this.container) return;
    this.container.dataset.panState = [
      this.center.lat.toFixed(6),
      this.center.lng.toFixed(6),
      this.fallbackPan.x.toFixed(1),
      this.fallbackPan.y.toFixed(1),
    ].join(",");
  }
}

function projectBoundsPoints(project: Project): Array<Omit<RoutePoint, "id">> {
  return [
    ...project.segments.flatMap((segment) => segment.points.map(({ lat, lng }) => ({ lat, lng }))),
    ...project.waypoints.map(({ lat, lng }) => ({ lat, lng })),
  ].filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
}

function averagePoint(points: Array<Omit<RoutePoint, "id">>): Omit<RoutePoint, "id"> {
  const sum = points.reduce(
    (acc, point) => ({ lat: acc.lat + point.lat, lng: acc.lng + point.lng }),
    { lat: 0, lng: 0 },
  );
  return {
    lat: sum.lat / points.length,
    lng: sum.lng / points.length,
  };
}

type FallbackViewport = {
  height: number;
  topLeft: { x: number; y: number };
  width: number;
  zoom: number;
};

function fallbackViewport(
  container: HTMLElement,
  center: Omit<RoutePoint, "id">,
  zoom: number,
  pan: { x: number; y: number },
): FallbackViewport {
  const rect = container.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width || container.clientWidth || 1000));
  const height = Math.max(1, Math.round(rect.height || container.clientHeight || 1000));
  const tileZoom = Math.max(1, Math.min(19, Math.round(zoom)));
  const centerWorld = latLngToWorld(center.lat, center.lng, tileZoom);
  return {
    height,
    topLeft: {
      x: centerWorld.x - width / 2 - pan.x,
      y: centerWorld.y - height / 2 - pan.y,
    },
    width,
    zoom: tileZoom,
  };
}

function osmTiles(viewport: FallbackViewport, mode: MapMode): string {
  const minTileX = Math.floor(viewport.topLeft.x / OSM_TILE_SIZE);
  const maxTileX = Math.floor((viewport.topLeft.x + viewport.width) / OSM_TILE_SIZE);
  const minTileY = Math.floor(viewport.topLeft.y / OSM_TILE_SIZE);
  const maxTileY = Math.floor((viewport.topLeft.y + viewport.height) / OSM_TILE_SIZE);
  const scale = 2 ** viewport.zoom;
  const maxTile = scale - 1;
  const opacity = mode === "satellite" ? "opacity:.72; filter:saturate(.72) contrast(.96);" : "";
  const tiles: string[] = [];
  for (let tileY = minTileY; tileY <= maxTileY; tileY += 1) {
    if (tileY < 0 || tileY > maxTile) continue;
    for (let tileX = minTileX; tileX <= maxTileX; tileX += 1) {
      const wrappedX = ((tileX % scale) + scale) % scale;
      const left = tileX * OSM_TILE_SIZE - viewport.topLeft.x;
      const top = tileY * OSM_TILE_SIZE - viewport.topLeft.y;
      tiles.push(
        `<img alt="" draggable="false" src="https://tile.openstreetmap.org/${viewport.zoom}/${wrappedX}/${tileY}.png" style="position:absolute; left:${left.toFixed(1)}px; top:${top.toFixed(1)}px; width:${OSM_TILE_SIZE}px; height:${OSM_TILE_SIZE}px; user-select:none; ${opacity}" />`,
      );
    }
  }
  return tiles.join("");
}

function fallbackProjectSvg(project: Project | undefined, callbacks: ProjectRenderCallbacks, viewport: FallbackViewport): string {
  if (!project) return "";
  const showRoutes = callbacks.showRoutes ?? true;
  const showWaypoints = callbacks.showWaypoints ?? true;
  const showPointHandles = callbacks.showPointHandles ?? true;
  const routeColor = callbacks.routeColor || DEFAULT_ROUTE_COLOR;
  const routes = project.segments
    .filter((segment) => showRoutes && segment.points.length >= 2)
    .map((segment) => {
      const path = visibleRoutePoints(segment.points)
        .map((point, index) => {
          const projected = fallbackProjectPoint(point, viewport);
          return `${index ? "L" : "M"} ${projected.x.toFixed(1)} ${projected.y.toFixed(1)}`;
        })
        .join(" ");
      const strokeWidth = segment.id === callbacks.selectedSegmentId ? 10 : 8;
      return `<path data-fallback-segment-id="${escapeHtml(segment.id)}" d="${path}" fill="none" stroke="${escapeHtml(routeColor)}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" style="cursor: crosshair;" />`;
    })
    .join("");
  const points = project.segments
    .filter((segment) => showRoutes && showPointHandles && segment.id === callbacks.selectedSegmentId)
    .flatMap((segment) => visibleHandlePoints(segment).map((point) => ({ point, segmentId: segment.id })))
    .map(({ point, segmentId }) => {
      const projected = fallbackProjectPoint(point, viewport);
      return `<circle data-fallback-segment-id="${escapeHtml(segmentId)}" data-fallback-point-id="${escapeHtml(point.id)}" cx="${projected.x.toFixed(1)}" cy="${projected.y.toFixed(1)}" r="7" fill="#d93a2f" stroke="#fff8ed" stroke-width="2.5" vector-effect="non-scaling-stroke" style="cursor: move;" />`;
    })
    .join("");
  const endpoints = showRoutes
    ? (callbacks.showConnectionEndpoints ? segmentEndpointMarkers(project) : routeEndpointMarkers(project))
        .map((endpoint) => {
          const projected = fallbackProjectPoint(endpoint.point, viewport);
          const label = endpoint.kind === "start" ? "S" : "F";
          const fill = endpoint.kind === "start" ? "#1f6b53" : "#23211d";
          const active = isConnectionStart(endpoint, callbacks.connectionStart);
          return `<g data-fallback-segment-id="${escapeHtml(endpoint.segmentId)}" data-fallback-point-id="${escapeHtml(endpoint.point.id)}" style="cursor: pointer;">
            ${active ? `<circle cx="${projected.x.toFixed(1)}" cy="${projected.y.toFixed(1)}" r="20" fill="none" stroke="#d6a23a" stroke-width="4" vector-effect="non-scaling-stroke" />` : ""}
            <circle cx="${projected.x.toFixed(1)}" cy="${projected.y.toFixed(1)}" r="15" fill="${fill}" stroke="#fff8ed" stroke-width="3" vector-effect="non-scaling-stroke" />
            <text x="${projected.x.toFixed(1)}" y="${(projected.y + 4).toFixed(1)}" text-anchor="middle" font-family="SUIT, sans-serif" font-size="13" font-weight="800" fill="#fff8ed">${label}</text>
          </g>`;
        })
        .join("")
    : "";
  const waypoints = project.waypoints
    .filter(() => showWaypoints)
    .map((waypoint) => {
      const projected = fallbackProjectPoint(waypoint, viewport);
      return `<circle data-fallback-waypoint-id="${escapeHtml(waypoint.id)}" cx="${projected.x.toFixed(1)}" cy="${projected.y.toFixed(1)}" r="10" fill="#1f6b53" stroke="#23211d" stroke-width="2" vector-effect="non-scaling-stroke" style="cursor: move;"><title>${escapeHtml(waypoint.title)}</title></circle>`;
    })
    .join("");
  return `${routes}${points}${endpoints}${waypoints}`;
}

function fallbackProjectPoint(point: Omit<RoutePoint, "id">, viewport: FallbackViewport): { x: number; y: number } {
  const world = latLngToWorld(point.lat, point.lng, viewport.zoom);
  return {
    x: world.x - viewport.topLeft.x,
    y: world.y - viewport.topLeft.y,
  };
}

function fallbackPointerTarget(target: EventTarget | null): FallbackPointerTarget {
  if (!(target instanceof Element)) return { kind: "pan" };
  const point = target.closest<SVGElement>("[data-fallback-point-id][data-fallback-segment-id]");
  if (point) {
    const pointId = point.dataset.fallbackPointId;
    const segmentId = point.dataset.fallbackSegmentId;
    if (pointId && segmentId) return { kind: "point", pointId, segmentId };
  }
  const waypoint = target.closest<SVGElement>("[data-fallback-waypoint-id]");
  if (waypoint?.dataset.fallbackWaypointId) {
    return { kind: "waypoint", waypointId: waypoint.dataset.fallbackWaypointId };
  }
  const segment = target.closest<SVGElement>("[data-fallback-segment-id]");
  if (segment?.dataset.fallbackSegmentId) {
    return { kind: "segment", segmentId: segment.dataset.fallbackSegmentId };
  }
  return { kind: "pan" };
}

function latLngToWorld(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const sinLat = Math.sin((Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI) / 180);
  const scale = OSM_TILE_SIZE * 2 ** zoom;
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * scale,
  };
}

function worldToLatLng(x: number, y: number, zoom: number): Omit<RoutePoint, "id"> {
  const scale = OSM_TILE_SIZE * 2 ** zoom;
  const lng = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lat, lng };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function waypointMarkerImage(kakao: KakaoNamespace, type: WaypointType): unknown {
  const option = waypointMarkerOptions[type];
  const svg = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="34" height="42" viewBox="0 0 34 42">
      <path fill="${option.color}" stroke="#23211d" stroke-width="2" d="M17 40s14-10.2 14-24A14 14 0 0 0 3 16c0 13.8 14 24 14 24Z"/>
      <circle cx="17" cy="16" r="9" fill="#fff8ed"/>
      <text x="17" y="20" text-anchor="middle" font-family="SUIT, sans-serif" font-size="11" font-weight="700" fill="#23211d">${option.label}</text>
    </svg>
  `);
  return new kakao.maps.MarkerImage(
    `data:image/svg+xml;charset=UTF-8,${svg}`,
    new kakao.maps.Size(34, 42),
    { offset: new kakao.maps.Point(17, 40) },
  );
}

function pointMarkerImage(kakao: KakaoNamespace): unknown {
  const svg = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18">
      <circle cx="9" cy="9" r="6.5" fill="#d93a2f" stroke="#fff8ed" stroke-width="3"/>
      <circle cx="9" cy="9" r="8" fill="none" stroke="rgba(35,33,29,.24)" stroke-width="1"/>
    </svg>
  `);
  return new kakao.maps.MarkerImage(
    `data:image/svg+xml;charset=UTF-8,${svg}`,
    new kakao.maps.Size(18, 18),
    { offset: new kakao.maps.Point(9, 9) },
  );
}

function routeEndpointMarkerImage(kakao: KakaoNamespace, kind: "start" | "finish", active: boolean): unknown {
  const label = kind === "start" ? "S" : "F";
  const fill = kind === "start" ? "#1f6b53" : "#23211d";
  const svg = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" width="42" height="42" viewBox="0 0 42 42">
      ${active ? `<circle cx="21" cy="21" r="19" fill="none" stroke="#d6a23a" stroke-width="4"/>` : ""}
      <circle cx="21" cy="21" r="14" fill="${fill}" stroke="#fff8ed" stroke-width="4"/>
      <circle cx="21" cy="21" r="16" fill="none" stroke="rgba(35,33,29,.25)" stroke-width="1"/>
      <text x="21" y="26" text-anchor="middle" font-family="SUIT, sans-serif" font-size="14" font-weight="800" fill="#fff8ed">${label}</text>
    </svg>
  `);
  return new kakao.maps.MarkerImage(
    `data:image/svg+xml;charset=UTF-8,${svg}`,
    new kakao.maps.Size(42, 42),
    { offset: new kakao.maps.Point(21, 21) },
  );
}

const waypointMarkerOptions: Record<WaypointType, { color: string; label: string }> = {
  start: { color: "#1f6b53", label: "S" },
  finish: { color: "#23211d", label: "F" },
  fuel: { color: "#d35d31", label: "G" },
  food: { color: "#b3832e", label: "식" },
  camp: { color: "#4f6f46", label: "C" },
  warning: { color: "#a93f31", label: "!" },
};

function pointMarkerKey(segmentId: string, pointId: string): string {
  return `point:${segmentId}:${pointId}`;
}

function routeEndpointMarkerKey(kind: "start" | "finish", segmentId: string): string {
  return `route-endpoint:${segmentId}:${kind}`;
}

function waypointMarkerKey(waypointId: string): string {
  return `waypoint:${waypointId}`;
}

function routeEndpointMarkers(
  project: Project,
): Array<{ kind: "start" | "finish"; point: RoutePoint; segmentId: string }> {
  const locatedPoints = project.segments.flatMap((segment) =>
    segment.points.map((point) => ({ point, segmentId: segment.id })),
  );
  const first = locatedPoints[0];
  const last = locatedPoints.at(-1);
  if (!first) return [];
  if (!last || last.point.id === first.point.id) return [{ kind: "start", ...first }];
  return [
    { kind: "start", ...first },
    { kind: "finish", ...last },
  ];
}

function segmentEndpointMarkers(
  project: Project,
): Array<{ kind: "start" | "finish"; point: RoutePoint; segmentId: string }> {
  return project.segments.flatMap((segment) => {
    const start = segment.points[0];
    const finish = segment.points.at(-1);
    if (!start) return [];
    if (!finish || finish.id === start.id) return [{ kind: "start" as const, point: start, segmentId: segment.id }];
    return [
      { kind: "start" as const, point: start, segmentId: segment.id },
      { kind: "finish" as const, point: finish, segmentId: segment.id },
    ];
  });
}

function nearestContextSegmentId(project: Project, point: Omit<RoutePoint, "id">): string | undefined {
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestSegmentId: string | undefined;
  project.segments.forEach((segment) => {
    for (let index = 0; index < segment.points.length - 1; index += 1) {
      const distance = pointToRouteLineDistance(point, segment.points[index], segment.points[index + 1]);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestSegmentId = segment.id;
      }
    }
  });
  return bestDistance <= CONTEXT_MENU_ROUTE_TOLERANCE ? bestSegmentId : undefined;
}

function pointToRouteLineDistance(
  point: Omit<RoutePoint, "id">,
  start: RoutePoint,
  end: RoutePoint,
): number {
  const dx = end.lng - start.lng;
  const dy = end.lat - start.lat;
  const length = dx * dx + dy * dy;
  if (!length) return Math.hypot(point.lng - start.lng, point.lat - start.lat);
  const t = Math.max(0, Math.min(1, ((point.lng - start.lng) * dx + (point.lat - start.lat) * dy) / length));
  return Math.hypot(point.lng - (start.lng + t * dx), point.lat - (start.lat + t * dy));
}

const CONTEXT_MENU_ROUTE_TOLERANCE = 0.0005;

const DEFAULT_ROUTE_COLOR = "#e03024";

function segmentSignature(
  segment: RouteSegment,
  visiblePoints: RoutePoint[],
  isSelected: boolean,
  routeColor: string,
): string {
  return [
    isSelected ? "selected" : "normal",
    routeColor,
    segment.points.length,
    visiblePoints.length,
    ...visiblePoints.map((point) => coordinateSignature(point)),
  ].join("|");
}

function pointSignature(point: RoutePoint): string {
  return coordinateSignature(point);
}

function waypointSignature(waypoint: Waypoint): string {
  return [
    waypoint.type,
    waypoint.title,
    waypoint.description || "",
    coordinateSignature(waypoint),
  ].join("|");
}

function routeEndpointSignature(
  endpoint: {
    kind: "start" | "finish";
    point: RoutePoint;
    segmentId: string;
  },
  active: boolean,
): string {
  return [
    endpoint.kind,
    endpoint.segmentId,
    endpoint.point.id,
    coordinateSignature(endpoint.point),
    active ? "active" : "idle",
  ].join("|");
}

function isConnectionStart(
  endpoint: { point: RoutePoint; segmentId: string },
  connectionStart: { segmentId: string; pointId: string } | undefined,
): boolean {
  return Boolean(
    connectionStart &&
      endpoint.segmentId === connectionStart.segmentId &&
      endpoint.point.id === connectionStart.pointId,
  );
}

export function computeProjectRenderInfo(project: Project, callbacks: ProjectRenderCallbacks = {}): ProjectRenderInfo {
  const showRoutes = callbacks.showRoutes ?? true;
  const showPointHandles = callbacks.showPointHandles ?? true;
  const totalRoutePoints = project.segments.reduce((sum, segment) => sum + segment.points.length, 0);
  let renderedRoutePoints = 0;
  let renderedPointHandles = 0;
  let hiddenPointHandles = 0;

  if (showRoutes) {
    project.segments.forEach((segment) => {
      if (segment.points.length >= 2) {
        renderedRoutePoints += visibleRoutePoints(segment.points).length;
      }
      if (showPointHandles && segment.id === callbacks.selectedSegmentId) {
        const handles = visibleHandlePoints(segment);
        renderedPointHandles += handles.length;
        hiddenPointHandles += Math.max(0, segment.points.length - handles.length);
      }
    });
  }

  return {
    hiddenPointHandles,
    renderedPointHandles,
    renderedRoutePoints,
    totalRoutePoints,
  };
}

function coordinateSignature(point: Omit<RoutePoint, "id">): string {
  return `${point.lat.toFixed(7)},${point.lng.toFixed(7)}`;
}

function visibleHandlePoints(segment: RouteSegment): RoutePoint[] {
  if (segment.points.length <= 2) return segment.points;
  const simplified = simplifyHandlePoints(segment.points, HANDLE_SIMPLIFY_TOLERANCE);
  if (simplified.length <= MAX_VISIBLE_POINT_HANDLES) return simplified;
  const step = Math.ceil(simplified.length / MAX_VISIBLE_POINT_HANDLES);
  const sampled = simplified.filter((_, index) => index % step === 0);
  const last = simplified.at(-1);
  if (last && sampled.at(-1)?.id !== last.id) sampled.push(last);
  return sampled;
}

function visibleHandlePointsWithSelection(segment: RouteSegment, selectedPointId: string | undefined): RoutePoint[] {
  const points = visibleHandlePoints(segment);
  const selectedPoint = selectedPointId ? segment.points.find((point) => point.id === selectedPointId) : undefined;
  if (!selectedPoint || points.some((point) => point.id === selectedPoint.id)) return points;
  return [...points, selectedPoint].sort(
    (left, right) =>
      segment.points.findIndex((point) => point.id === left.id) -
      segment.points.findIndex((point) => point.id === right.id),
  );
}

function simplifyHandlePoints(points: RoutePoint[], tolerance: number): RoutePoint[] {
  const keep = new Set<number>([0, points.length - 1]);
  simplifyRange(points, 0, points.length - 1, tolerance * tolerance, keep);
  return Array.from(keep)
    .sort((left, right) => left - right)
    .map((index) => points[index]);
}

function simplifyRange(
  points: RoutePoint[],
  start: number,
  end: number,
  toleranceSquared: number,
  keep: Set<number>,
): void {
  if (end <= start + 1) return;
  let maxDistance = 0;
  let maxIndex = -1;
  for (let index = start + 1; index < end; index += 1) {
    const distance = perpendicularDistanceSquared(points[index], points[start], points[end]);
    if (distance > maxDistance) {
      maxDistance = distance;
      maxIndex = index;
    }
  }
  if (maxDistance <= toleranceSquared || maxIndex < 0) return;
  keep.add(maxIndex);
  simplifyRange(points, start, maxIndex, toleranceSquared, keep);
  simplifyRange(points, maxIndex, end, toleranceSquared, keep);
}

function perpendicularDistanceSquared(
  point: RoutePoint,
  start: RoutePoint,
  end: RoutePoint,
): number {
  const dx = end.lng - start.lng;
  const dy = end.lat - start.lat;
  if (dx === 0 && dy === 0) {
    const pointDx = point.lng - start.lng;
    const pointDy = point.lat - start.lat;
    return pointDx * pointDx + pointDy * pointDy;
  }
  const t = ((point.lng - start.lng) * dx + (point.lat - start.lat) * dy) / (dx * dx + dy * dy);
  const projectedLng = start.lng + t * dx;
  const projectedLat = start.lat + t * dy;
  const distanceLng = point.lng - projectedLng;
  const distanceLat = point.lat - projectedLat;
  return distanceLng * distanceLng + distanceLat * distanceLat;
}

function visibleRoutePoints(points: RoutePoint[]): RoutePoint[] {
  if (points.length <= SIMPLIFY_POINT_THRESHOLD) return points;
  const coordinates = points.map((point) => [point.lng, point.lat]);
  const simplified = simplify(lineString(coordinates), {
    highQuality: false,
    mutate: false,
    tolerance: simplifyTolerance(points.length),
  });
  const simplifiedPoints = simplified.geometry.coordinates
    .map(([lng, lat], index) => ({ id: `render-${index}`, lat, lng }))
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng));
  return simplifiedPoints.length >= 2 ? simplifiedPoints : points;
}

function simplifyTolerance(pointCount: number): number {
  if (pointCount >= 8000) return 0.00008;
  if (pointCount >= 4000) return 0.00005;
  return 0.00003;
}

function loadKakaoSdk(): Promise<KakaoNamespace> {
  if (window.kakao?.maps) {
    return new Promise((resolve) => window.kakao!.maps.load(() => resolve(window.kakao!)));
  }
  const appKey = kakaoApiKey();
  if (window.__tourMapKakaoPromise && window.__tourMapKakaoPromiseKey === appKey) return window.__tourMapKakaoPromise;

  if (!appKey) {
    return Promise.reject(new Error("Missing Kakao API key"));
  }

  window.__tourMapKakaoPromiseKey = appKey;
  window.__tourMapKakaoPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.dataset.tourMapKakaoSdk = "true";
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(
      appKey,
    )}&autoload=false&libraries=services`;
    script.async = true;
    script.onload = () => {
      if (!window.kakao?.maps) {
        reject(new Error("Kakao SDK unavailable"));
        return;
      }
      window.kakao.maps.load(() => resolve(window.kakao!));
    };
    script.onerror = () => reject(new Error("Failed to load Kakao SDK"));
    document.head.appendChild(script);
  });
  return window.__tourMapKakaoPromise;
}

function kakaoApiKey(): string {
  try {
    return localStorage.getItem(KAKAO_API_KEY_STORAGE_KEY)?.trim() || process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY || "";
  } catch {
    return process.env.NEXT_PUBLIC_KAKAO_MAP_API_KEY || "";
  }
}

function resetKakaoSdkLoader(): void {
  window.__tourMapKakaoPromise = undefined;
  window.__tourMapKakaoPromiseKey = undefined;
  document.querySelectorAll("script[data-tour-map-kakao-sdk='true']").forEach((script) => script.remove());
}

function mapLoadErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("Missing Kakao API key")) {
    return "Kakao API 키가 설정되지 않았습니다.";
  }
  if (message.includes("Kakao SDK unavailable")) {
    return "Kakao SDK가 응답하지 않습니다. API 키와 JavaScript 도메인 설정을 확인하세요.";
  }
  return "카카오맵 SDK를 불러오지 못했습니다. 네트워크, API 키, JavaScript 도메인 설정을 확인하세요.";
}

function searchLoadErrorMessage(error: unknown): string {
  const message = mapLoadErrorMessage(error);
  return `주소 검색은 카카오맵 SDK가 연결되어야 사용할 수 있습니다. ${message}`;
}

function pointFromLatLng(latLng: KakaoLatLng): Omit<RoutePoint, "id"> {
  return {
    lat: latLng.getLat(),
    lng: latLng.getLng(),
  };
}

function pointFromSearchResult(result: { x: string; y: string }): RoutePoint {
  return {
    id: "search-result",
    lat: Number(result.y),
    lng: Number(result.x),
  };
}

function zoomToKakaoLevel(zoom: number): number {
  return Math.max(1, Math.min(14, 18 - zoom));
}
