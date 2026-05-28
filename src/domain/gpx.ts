import type { Project, RoutePoint, RouteSegment, Waypoint, WaypointType } from "./types";

export type GpxImportResult = Pick<Project, "segments" | "waypoints"> & {
  skippedPoints: number;
  title?: string;
};

export function parseGpx(xmlText: string): GpxImportResult {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  if (descendantsByName(doc, "parsererror").length) {
    throw new Error("Invalid GPX file");
  }

  const segments: RouteSegment[] = [];
  let skippedPoints = 0;
  descendantsByName(doc, "trk").forEach((track, trackIndex) => {
    const trackName = childText(track, "name") || `트랙 ${trackIndex + 1}`;
    descendantsByName(track, "trkseg").forEach((node, segmentIndex) => {
      const points = compactPoints(descendantsByName(node, "trkpt"));
      skippedPoints += points.skipped;
      if (points.items.length) {
        const name = segmentIndex ? `${trackName} ${segmentIndex + 1}` : trackName;
        segments.push({ id: createId("seg"), name, points: points.items });
      }
    });
  });

  descendantsByName(doc, "rte").forEach((node, index) => {
    const points = compactPoints(descendantsByName(node, "rtept"));
    skippedPoints += points.skipped;
    if (points.items.length) {
      segments.push({ id: createId("seg"), name: childText(node, "name") || `루트 ${index + 1}`, points: points.items });
    }
  });

  const waypoints: Waypoint[] = [];
  descendantsByName(doc, "wpt").forEach((node) => {
    const point = pointFromNode(node);
    if (!point) {
      skippedPoints += 1;
      return;
    }
    waypoints.push({
      id: createId("wpt"),
      lat: point.lat,
      lng: point.lng,
      title: childText(node, "name") || "웨이포인트",
      description: childText(node, "desc"),
      type: normalizeWaypointType(childText(node, "type") || childText(node, "sym")),
    });
  });

  if (!segments.length && !waypoints.length) {
    throw new Error("GPX에서 경로 또는 웨이포인트를 찾지 못했습니다.");
  }

  return {
    segments,
    skippedPoints,
    title:
      nestedChildText(doc.documentElement, ["metadata", "name"]) ||
      nestedChildText(doc.documentElement, ["trk", "name"]) ||
      nestedChildText(doc.documentElement, ["rte", "name"]),
    waypoints,
  };
}

export function exportGpx(project: Project, type: "track" | "route"): string {
  const exportableSegments = project.segments
    .map((segment) => ({
      ...segment,
      points: segment.points.filter((point) => isValidCoordinate(point.lat, point.lng)),
    }))
    .filter((segment) => segment.points.length > 0);
  const body =
    type === "track"
      ? `<trk><name>${escapeXml(project.title)}</name>${exportableSegments
          .map(
            (segment) =>
              `<trkseg>${segment.points
                .map((point) => `<trkpt lat="${point.lat}" lon="${point.lng}" />`)
                .join("")}</trkseg>`,
          )
          .join("")}</trk>`
      : exportableSegments
          .map(
            (segment) =>
              `<rte><name>${escapeXml(segment.name)}</name>${segment.points
                .map((point) => `<rtept lat="${point.lat}" lon="${point.lng}" />`)
                .join("")}</rte>`,
          )
          .join("");

  const waypointXml = project.waypoints
    .filter((waypoint) => isValidCoordinate(waypoint.lat, waypoint.lng))
    .map(
      (waypoint) =>
        `<wpt lat="${waypoint.lat}" lon="${waypoint.lng}"><name>${escapeXml(
          waypoint.title,
        )}</name><desc>${escapeXml(waypoint.description || "")}</desc><type>${waypoint.type}</type></wpt>`,
    )
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="TourMap Editor" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${escapeXml(project.title)}</name>
    <time>${new Date().toISOString()}</time>
  </metadata>
  ${waypointXml}
  ${body}
</gpx>`;
}

function compactPoints(nodes: Element[]): { items: RoutePoint[]; skipped: number } {
  const items: RoutePoint[] = [];
  let skipped = 0;
  nodes.forEach((node) => {
    const point = pointFromNode(node);
    if (point) {
      items.push(point);
    } else {
      skipped += 1;
    }
  });
  return { items, skipped };
}

function pointFromNode(node: Element): RoutePoint | undefined {
  const latValue = node.getAttribute("lat");
  const lngValue = node.getAttribute("lon") ?? node.getAttribute("lng");
  if (latValue === null || lngValue === null) return undefined;
  const lat = Number(latValue);
  const lng = Number(lngValue);
  if (!isValidCoordinate(lat, lng)) return undefined;
  return {
    id: createId("pt"),
    lat,
    lng,
  };
}

function isValidCoordinate(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

function descendantsByName(root: Document | Element, name: string): Element[] {
  const result: Element[] = [];
  const visit = (node: Document | Element) => {
    for (const child of childElements(node)) {
      if (localName(child) === name) result.push(child);
      visit(child);
    }
  };
  visit(root);
  return result;
}

function childText(node: Element, name: string): string {
  return childElements(node).find((child) => localName(child) === name)?.textContent?.trim() || "";
}

function nestedChildText(node: Element, path: string[]): string {
  let current: Element | undefined = node;
  for (const name of path) {
    current = childElements(current).find((child) => localName(child) === name);
    if (!current) return "";
  }
  return current.textContent?.trim() || "";
}

function childElements(node: Document | Element): Element[] {
  if ("documentElement" in node && !("tagName" in node)) {
    return node.documentElement ? [node.documentElement] : [];
  }
  return Array.from((node as Element).children || []);
}

function localName(node: Element): string {
  return (node.localName || node.tagName.split(":").at(-1) || "").toLowerCase();
}

function normalizeWaypointType(value: string): WaypointType {
  const normalized = value.toLowerCase();
  if (["start", "finish", "fuel", "food", "camp", "warning"].includes(normalized)) {
    return normalized as WaypointType;
  }
  if (["출발", "시작"].includes(normalized)) return "start";
  if (["도착", "종료"].includes(normalized)) return "finish";
  if (["주유", "주유소", "gas", "petrol"].includes(normalized)) return "fuel";
  if (["식사", "음식", "restaurant"].includes(normalized)) return "food";
  if (["캠프", "캠핑"].includes(normalized)) return "camp";
  if (["주의", "위험", "경고"].includes(normalized)) return "warning";
  return "warning";
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}
