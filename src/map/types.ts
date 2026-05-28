import type { MapMode, Project, RoutePoint, Waypoint } from "../domain/types";

export type ProjectRenderCallbacks = {
  onMapStatus?: (status: MapRuntimeStatus) => void;
  onRenderInfo?: (info: ProjectRenderInfo) => void;
  onMapClick?: (point: Omit<RoutePoint, "id">) => void;
  onPointClick?: (segmentId: string, pointId: string) => void;
  onPointDragEnd?: (segmentId: string, pointId: string, point: Omit<RoutePoint, "id">) => void;
  onSegmentClick?: (segmentId: string, point: Omit<RoutePoint, "id">) => void;
  onSegmentContextMenu?: (
    segmentId: string,
    point: Omit<RoutePoint, "id">,
    screenPoint: { x: number; y: number },
  ) => void;
  onWaypointClick?: (waypointId: string) => void;
  onWaypointDragEnd?: (waypoint: Waypoint) => void;
  selectedSegmentId?: string;
  selectedPointId?: string;
  connectionStart?: { segmentId: string; pointId: string };
  showConnectionEndpoints?: boolean;
  showPointHandles?: boolean;
  showRoutes?: boolean;
  showWaypoints?: boolean;
  routeColor?: string;
};

export type MapRuntimeStatus = {
  state: "loading" | "ready" | "error";
  message: string;
};

export type ProjectRenderInfo = {
  hiddenPointHandles: number;
  renderedPointHandles: number;
  renderedRoutePoints: number;
  totalRoutePoints: number;
};

export type MapAdapter = {
  destroy(): void;
  fitProject(project: Project): void;
  mount(container: HTMLElement): void;
  renderProject(project: Project, callbacks: ProjectRenderCallbacks): void;
  searchAddress(query: string): Promise<RoutePoint>;
  setMode(mode: MapMode): void;
  setView(center: RoutePoint, zoom: number): void;
};
