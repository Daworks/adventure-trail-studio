"use client";

import { create } from "zustand";
import { createId, exportGpx, parseGpx } from "../domain/gpx";
import type { GpxImportResult } from "../domain/gpx";
import { segmentDistanceKm, totalDistanceKm } from "../domain/geometry";
import { redoHistory, undoHistory } from "./editor-history";
import {
  applyAddPoint,
  applyConnectSegmentsByEndpoints,
  applyConnectSegmentToNext,
  applyDeletePoint,
  applyDeleteSegment,
  applyInsertPoint,
  applyMovePoint,
  applyReverseSegment,
  applySplitSegment,
  applySplitSegmentAtPoint,
  sameCoordinates,
  updateSegment,
} from "./editor-operations";
import type {
  EditorTool,
  MapMode,
  Project,
  RoutePoint,
  RouteSegment,
  Selection,
  Waypoint,
  WaypointType,
} from "../domain/types";

const apiBaseUrl = process.env.NEXT_PUBLIC_TOURMAP_API_BASE_URL ?? "";
const apiPath = (path: string) => `${apiBaseUrl}${path}`;

type Snapshot = Project;

type EditorState = {
  project: Project;
  projects: Project[];
  activeTool: EditorTool;
  mapMode: MapMode;
  selected: Selection;
  history: Snapshot[];
  future: Snapshot[];
  select: (selection: Selection) => void;
  setTool: (tool: EditorTool) => void;
  setMapMode: (mode: MapMode) => void;
  newProject: (title?: string) => void;
  updateTitle: (title: string) => void;
  addSegment: () => void;
  updateSegmentName: (segmentId: string, name: string) => void;
  addPoint: (point: Omit<RoutePoint, "id">) => void;
  movePoint: (segmentId: string, pointId: string, point: Omit<RoutePoint, "id">) => void;
  insertPoint: (segmentId: string, afterPointId: string, point: Omit<RoutePoint, "id">) => void;
  deletePoint: (segmentId: string, pointId: string) => void;
  splitSegment: (segmentId: string, pointId: string) => void;
  splitSegmentAtPoint: (segmentId: string, afterPointId: string, point: Omit<RoutePoint, "id">) => void;
  reverseSegment: (segmentId: string) => void;
  connectSegmentToNext: (segmentId: string) => void;
  connectSegmentsByEndpoints: (fromSegmentId: string, fromPointId: string, toSegmentId: string, toPointId: string) => void;
  deleteSegment: (segmentId: string) => void;
  addWaypoint: (waypoint: Omit<Waypoint, "id">) => void;
  updateWaypoint: (waypoint: Waypoint) => void;
  deleteWaypoint: (waypointId: string) => void;
  importGpxText: (xml: string) => GpxImportResult;
  exportGpxText: (type: "track" | "route") => string;
  saveProject: () => Promise<void>;
  loadProjects: () => Promise<void>;
  openProject: (projectId: string) => Promise<void>;
  deleteProject: (projectId: string) => Promise<void>;
  undo: () => void;
  redo: () => void;
};

const initialProject = createInitialProject();

export const useEditorStore = create<EditorState>((set, get) => ({
  project: initialProject,
  projects: [],
  activeTool: "select",
  mapMode: "standard",
  selected: { type: "segment", segmentId: initialProject.segments[0].id },
  history: [],
  future: [],

  select: (selection) => set({ selected: selection }),
  setTool: (tool) => set({ activeTool: tool }),
  setMapMode: (mode) => set({ mapMode: mode }),

  newProject: (title) => {
    const project = createProject(title);
    set({
      project,
      selected: { type: "segment", segmentId: project.segments[0].id },
      activeTool: "select",
      history: [],
      future: [],
    });
  },

  updateTitle: (title) =>
    mutate(set, get, (project) =>
      project.title === title
        ? project
        : {
            ...project,
            title,
            updatedAt: new Date().toISOString(),
          },
    ),

  addSegment: () => {
    const segment = createSegment(`구간 ${get().project.segments.length + 1}`);
    mutate(set, get, (project) => ({
      ...project,
      updatedAt: new Date().toISOString(),
      segments: [...project.segments, segment],
    }));
    set({ selected: { type: "segment", segmentId: segment.id }, activeTool: "select" });
  },

  updateSegmentName: (segmentId, name) =>
    mutate(set, get, (project) =>
      updateSegment(project, segmentId, new Date().toISOString(), (segment) =>
        segment.name === name
          ? segment
          : {
              ...segment,
              name,
            },
      ),
    ),

  addPoint: (point) =>
    mutate(set, get, (project) => {
      const activeSegmentId = activeSegment(project, get().selected).id;
      return applyAddPoint(project, activeSegmentId, point, createId, new Date().toISOString());
    }),

  movePoint: (segmentId, pointId, point) =>
    mutate(set, get, (project) =>
      applyMovePoint(project, segmentId, pointId, point, new Date().toISOString()),
    ),

  insertPoint: (segmentId, afterPointId, point) => {
    const pointId = createId("pt");
    mutate(set, get, (project) =>
      applyInsertPoint(project, segmentId, afterPointId, point, () => pointId, new Date().toISOString()),
    );
    const inserted = get().project.segments
      .find((segment) => segment.id === segmentId)
      ?.points.some((item) => item.id === pointId);
    if (inserted) set({ selected: { type: "point", segmentId, pointId } });
  },

  deletePoint: (segmentId, pointId) =>
    mutate(set, get, (project) => applyDeletePoint(project, segmentId, pointId, new Date().toISOString())),

  splitSegment: (segmentId, pointId) =>
    mutate(set, get, (project) =>
      applySplitSegment(project, segmentId, pointId, createId, new Date().toISOString()),
    ),

  splitSegmentAtPoint: (segmentId, afterPointId, point) =>
    mutate(set, get, (project) =>
      applySplitSegmentAtPoint(project, segmentId, afterPointId, point, createId, new Date().toISOString()),
    ),

  reverseSegment: (segmentId) =>
    mutate(set, get, (project) =>
      applyReverseSegment(project, segmentId, new Date().toISOString()),
    ),

  connectSegmentToNext: (segmentId) =>
    mutate(set, get, (project) =>
      applyConnectSegmentToNext(project, segmentId, new Date().toISOString()),
    ),

  connectSegmentsByEndpoints: (fromSegmentId, fromPointId, toSegmentId, toPointId) =>
    mutate(set, get, (project) =>
      applyConnectSegmentsByEndpoints(project, fromSegmentId, fromPointId, toSegmentId, toPointId, new Date().toISOString()),
    ),

  deleteSegment: (segmentId) => {
    mutate(set, get, (project) => {
      return applyDeleteSegment(project, segmentId, createSegment("구간 1"), new Date().toISOString());
    });
    const { project, selected } = get();
    if (selected?.type === "segment" && selected.segmentId === segmentId) {
      set({ selected: project.segments[0] ? { type: "segment", segmentId: project.segments[0].id } : null });
    }
  },

  addWaypoint: (waypoint) =>
    mutate(set, get, (project) => ({
      ...project,
      updatedAt: new Date().toISOString(),
      waypoints: [...project.waypoints, { id: createId("wpt"), ...waypoint }],
    })),

  updateWaypoint: (waypoint) =>
    mutate(set, get, (project) => {
      const target = project.waypoints.find((item) => item.id === waypoint.id);
      if (!target || sameWaypoint(target, waypoint)) return project;
      return {
        ...project,
        updatedAt: new Date().toISOString(),
        waypoints: project.waypoints.map((item) => (item.id === waypoint.id ? waypoint : item)),
      };
    }),

  deleteWaypoint: (waypointId) =>
    mutate(set, get, (project) => {
      if (!project.waypoints.some((waypoint) => waypoint.id === waypointId)) return project;
      return {
        ...project,
        updatedAt: new Date().toISOString(),
        waypoints: project.waypoints.filter((waypoint) => waypoint.id !== waypointId),
      };
    }),

  importGpxText: (xml) => {
    const parsed = parseGpx(xml);
    mutate(set, get, (project) => {
      return {
        ...project,
        title: parsed.title || project.title,
        updatedAt: new Date().toISOString(),
        segments: parsed.segments.length ? parsed.segments : project.segments,
        waypoints: parsed.waypoints,
      };
    });
    if (parsed.segments[0]) {
      set({ selected: { type: "segment", segmentId: parsed.segments[0].id } });
    } else if (parsed.waypoints[0]) {
      set({ selected: { type: "waypoint", waypointId: parsed.waypoints[0].id } });
    }
    return parsed;
  },

  exportGpxText: (type) => exportGpx(get().project, type),

  saveProject: async () => {
    const response = await fetch(apiPath("/api/projects"), {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(get().project),
    });
    if (!response.ok) throw new Error(await responseErrorMessage(response, "프로젝트를 저장하지 못했습니다."));
    await get().loadProjects();
  },

  loadProjects: async () => {
    const response = await fetch(apiPath("/api/projects"));
    if (!response.ok) return;
    const projects = (await response.json()) as Project[];
    set({ projects });
  },

  openProject: async (projectId) => {
    const response = await fetch(apiPath(`/api/projects/${projectId}`));
    if (!response.ok) throw new Error(await responseErrorMessage(response, "프로젝트를 열지 못했습니다."));
    const project = ensureEditableProject((await response.json()) as Project);
    set({
      project,
      selected: { type: "segment", segmentId: project.segments[0].id },
      history: [],
      future: [],
    });
  },

  deleteProject: async (projectId) => {
    const response = await fetch(apiPath(`/api/projects/${projectId}`), { method: "DELETE" });
    if (!response.ok) throw new Error(await responseErrorMessage(response, "프로젝트를 삭제하지 못했습니다."));
    if (get().project.id === projectId) {
      get().newProject();
    }
    await get().loadProjects();
  },

  undo: () => {
    const next = undoHistory(get());
    if (next) set(next);
  },

  redo: () => {
    const next = redoHistory(get());
    if (next) set(next);
  },
}));

export function projectDistance(project: Project): number {
  return totalDistanceKm(project.segments);
}

export function selectedSegmentDistance(project: Project, selected: Selection): number {
  return segmentDistanceKm(activeSegment(project, selected));
}

function mutate(
  set: (state: Partial<EditorState>) => void,
  get: () => EditorState,
  fn: (project: Project) => Project,
): void {
  const current = get().project;
  const next = fn(current);
  if (next === current) return;
  set({
    project: next,
    history: [...get().history, current].slice(-80),
    future: [],
  });
}

function sameWaypoint(current: Waypoint, next: Waypoint): boolean {
  return (
    current.id === next.id &&
    current.type === next.type &&
    current.title === next.title &&
    (current.description || "") === (next.description || "") &&
    sameCoordinates(current, next)
  );
}

async function responseErrorMessage(response: Response, fallback: string): Promise<string> {
  const detail = (await response.text()).trim();
  return detail ? `${fallback}: ${detail}` : fallback;
}

function activeSegment(project: Project, selected: Selection): RouteSegment {
  const selectedId =
    selected?.type === "segment" || selected?.type === "point" ? selected.segmentId : undefined;
  return project.segments.find((segment) => segment.id === selectedId) || project.segments[0];
}

function createInitialProject(): Project {
  return {
    id: "project-initial",
    title: "무제 투어링 코스",
    createdAt: "2026-05-27T15:00:00.000Z",
    updatedAt: "2026-05-27T15:00:00.000Z",
    segments: [{ id: "seg-initial", name: "구간 1", points: [] }],
    waypoints: [],
  };
}

function createProject(title = "무제 투어링 코스"): Project {
  const now = new Date().toISOString();
  return {
    id: createId("project"),
    title,
    createdAt: now,
    updatedAt: now,
    segments: [createSegment("구간 1")],
    waypoints: [],
  };
}

function ensureEditableProject(project: Project): Project {
  if (project.segments.length) return project;
  return {
    ...project,
    segments: [createSegment("구간 1")],
  };
}

function createSegment(name: string): RouteSegment {
  return {
    id: createId("seg"),
    name,
    points: [],
  };
}

export const waypointTypes: WaypointType[] = ["start", "finish", "fuel", "food", "camp", "warning"];
