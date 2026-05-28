import type { Project, RoutePoint, RouteSegment } from "../domain/types";

type IdFactory = (prefix: string) => string;

export function applyAddPoint(
  project: Project,
  segmentId: string,
  point: Omit<RoutePoint, "id">,
  idFactory: IdFactory,
  now: string,
): Project {
  return updateSegment(project, segmentId, now, (segment) => ({
    ...segment,
    points: [...segment.points, { id: idFactory("pt"), ...point }],
  }));
}

export function applyMovePoint(
  project: Project,
  segmentId: string,
  pointId: string,
  point: Omit<RoutePoint, "id">,
  now: string,
): Project {
  return updateSegment(project, segmentId, now, (segment) => {
    const target = segment.points.find((item) => item.id === pointId);
    if (!target || sameCoordinates(target, point)) return segment;
    return {
      ...segment,
      points: segment.points.map((item) => (item.id === pointId ? { ...item, ...point } : item)),
    };
  });
}

export function applyInsertPoint(
  project: Project,
  segmentId: string,
  afterPointId: string,
  point: Omit<RoutePoint, "id">,
  idFactory: IdFactory,
  now: string,
): Project {
  return updateSegment(project, segmentId, now, (segment) => {
    const index = segment.points.findIndex((item) => item.id === afterPointId);
    if (index < 0) return segment;
    const points = [...segment.points];
    points.splice(index + 1, 0, { id: idFactory("pt"), ...point });
    return { ...segment, points };
  });
}

export function applyDeletePoint(
  project: Project,
  segmentId: string,
  pointId: string,
  now: string,
): Project {
  return updateSegment(project, segmentId, now, (segment) => {
    if (!segment.points.some((point) => point.id === pointId)) return segment;
    return {
      ...segment,
      points: segment.points.filter((point) => point.id !== pointId),
    };
  });
}

export function applySplitSegment(
  project: Project,
  segmentId: string,
  pointId: string,
  idFactory: IdFactory,
  now: string,
): Project {
  const segment = project.segments.find((item) => item.id === segmentId);
  if (!segment) return project;
  const index = segment.points.findIndex((point) => point.id === pointId);
  if (index <= 0 || index >= segment.points.length - 1) return project;
  const first = { ...segment, points: segment.points.slice(0, index + 1) };
  const second: RouteSegment = {
    id: idFactory("seg"),
    name: `${segment.name} 분할`,
    points: segment.points.slice(index),
  };
  return {
    ...project,
    updatedAt: now,
    segments: project.segments.flatMap((item) => (item.id === segment.id ? [first, second] : [item])),
  };
}

export function applySplitSegmentAtPoint(
  project: Project,
  segmentId: string,
  afterPointId: string,
  point: Omit<RoutePoint, "id">,
  idFactory: IdFactory,
  now: string,
): Project {
  const segment = project.segments.find((item) => item.id === segmentId);
  if (!segment) return project;
  const index = segment.points.findIndex((item) => item.id === afterPointId);
  if (index < 0 || index >= segment.points.length - 1) return project;
  const splitPoint = { id: idFactory("pt"), ...point };
  const first = { ...segment, points: [...segment.points.slice(0, index + 1), splitPoint] };
  const second: RouteSegment = {
    id: idFactory("seg"),
    name: `${segment.name} 분할`,
    points: [splitPoint, ...segment.points.slice(index + 1)],
  };
  return {
    ...project,
    updatedAt: now,
    segments: project.segments.flatMap((item) => (item.id === segment.id ? [first, second] : [item])),
  };
}

export function applyReverseSegment(
  project: Project,
  segmentId: string,
  now: string,
): Project {
  return updateSegment(project, segmentId, now, (segment) => {
    if (segment.points.length < 2) return segment;
    return {
      ...segment,
      points: [...segment.points].reverse(),
    };
  });
}

export function applyConnectSegmentToNext(
  project: Project,
  segmentId: string,
  now: string,
): Project {
  if (project.segments.length < 2) return project;
  const index = project.segments.findIndex((segment) => segment.id === segmentId);
  if (index < 0) return project;
  const nextIndex = (index + 1) % project.segments.length;
  const current = project.segments[index];
  const next = project.segments[nextIndex];
  const nextPoints = shouldDropConnectionDuplicate(current, next) ? next.points.slice(1) : next.points;
  const connected: RouteSegment = {
    ...current,
    name: `${current.name} + ${next.name}`,
    points: [...current.points, ...nextPoints],
  };
  const segments = project.segments
    .map((segment, segmentIndex) => (segmentIndex === index ? connected : segment))
    .filter((_, segmentIndex) => segmentIndex !== nextIndex);
  return {
    ...project,
    updatedAt: now,
    segments,
  };
}

export function applyConnectSegmentsByEndpoints(
  project: Project,
  fromSegmentId: string,
  fromPointId: string,
  toSegmentId: string,
  toPointId: string,
  now: string,
): Project {
  if (fromSegmentId === toSegmentId) return project;
  const fromIndex = project.segments.findIndex((segment) => segment.id === fromSegmentId);
  const toIndex = project.segments.findIndex((segment) => segment.id === toSegmentId);
  if (fromIndex < 0 || toIndex < 0) return project;
  const fromSegment = project.segments[fromIndex];
  const toSegment = project.segments[toIndex];
  const fromEndpoint = segmentEndpointKind(fromSegment, fromPointId);
  const toEndpoint = segmentEndpointKind(toSegment, toPointId);
  if (!fromEndpoint || !toEndpoint) return project;

  const fromPoints = fromEndpoint === "start" ? [...fromSegment.points].reverse() : [...fromSegment.points];
  const orientedToPoints = toEndpoint === "finish" ? [...toSegment.points].reverse() : [...toSegment.points];
  const toPoints = shouldDropPointDuplicate(fromPoints.at(-1), orientedToPoints[0])
    ? orientedToPoints.slice(1)
    : orientedToPoints;
  const connected: RouteSegment = {
    ...fromSegment,
    name: `${fromSegment.name} + ${toSegment.name}`,
    points: [...fromPoints, ...toPoints],
  };
  return {
    ...project,
    updatedAt: now,
    segments: project.segments
      .map((segment, index) => (index === fromIndex ? connected : segment))
      .filter((_, index) => index !== toIndex),
  };
}

export function applyDeleteSegment(
  project: Project,
  segmentId: string,
  replacementSegment: RouteSegment,
  now: string,
): Project {
  if (!project.segments.some((segment) => segment.id === segmentId)) return project;
  if (project.segments.length === 1) {
    return {
      ...project,
      updatedAt: now,
      segments: [replacementSegment],
    };
  }
  return {
    ...project,
    updatedAt: now,
    segments: project.segments.filter((segment) => segment.id !== segmentId),
  };
}

function shouldDropConnectionDuplicate(current: RouteSegment, next: RouteSegment): boolean {
  return shouldDropPointDuplicate(current.points.at(-1), next.points[0]);
}

function shouldDropPointDuplicate(current: RoutePoint | undefined, next: RoutePoint | undefined): boolean {
  return Boolean(current && next && (current.id === next.id || sameCoordinates(current, next)));
}

function segmentEndpointKind(segment: RouteSegment, pointId: string): "start" | "finish" | undefined {
  if (segment.points[0]?.id === pointId) return "start";
  if (segment.points.at(-1)?.id === pointId) return "finish";
  return undefined;
}

export function updateSegment(
  project: Project,
  segmentId: string,
  now: string,
  fn: (segment: RouteSegment) => RouteSegment,
): Project {
  let changed = false;
  const segments = project.segments.map((segment) => {
    if (segment.id !== segmentId) return segment;
    const next = fn(segment);
    if (next !== segment) changed = true;
    return next;
  });
  if (!changed) return project;
  return {
    ...project,
    updatedAt: now,
    segments,
  };
}

export function sameCoordinates(
  current: Pick<RoutePoint, "lat" | "lng">,
  next: Pick<RoutePoint, "lat" | "lng">,
): boolean {
  return current.lat === next.lat && current.lng === next.lng;
}
