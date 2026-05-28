export type WaypointType = "start" | "finish" | "fuel" | "food" | "camp" | "warning";

export type RoutePoint = {
  id: string;
  lat: number;
  lng: number;
};

export type RouteSegment = {
  id: string;
  name: string;
  points: RoutePoint[];
};

export type Waypoint = {
  id: string;
  type: WaypointType;
  lat: number;
  lng: number;
  title: string;
  description?: string;
};

export type Project = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  segments: RouteSegment[];
  waypoints: Waypoint[];
};

export type MapMode = "standard" | "satellite";
export type EditorTool = "draw" | "select" | "insert" | "connect" | "waypoint";

export type Selection =
  | { type: "segment"; segmentId: string }
  | { type: "point"; segmentId: string; pointId: string }
  | { type: "waypoint"; waypointId: string }
  | null;
