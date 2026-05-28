const GPX = {
  parse(xmlText) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, "application/xml");
    if (doc.querySelector("parsererror")) {
      throw new Error("Invalid GPX file");
    }

    const segments = [];
    const trksegs = Array.from(doc.querySelectorAll("trkseg"));
    trksegs.forEach((trkseg) => {
      const points = Array.from(trkseg.querySelectorAll("trkpt")).map((node) =>
        this.nodeToPoint(node),
      );
      if (points.length) segments.push({ points });
    });

    Array.from(doc.querySelectorAll("rte")).forEach((route) => {
      const points = Array.from(route.querySelectorAll("rtept")).map((node) =>
        this.nodeToPoint(node),
      );
      if (points.length) segments.push({ points });
    });

    const waypoints = Array.from(doc.querySelectorAll("wpt")).map((node) => ({
      lat: Number(node.getAttribute("lat")),
      lng: Number(node.getAttribute("lon")),
      title: text(node, "name") || "Waypoint",
      description: text(node, "desc"),
      type: normalizeType(text(node, "type") || text(node, "sym")),
      color: "#1f6b53",
    }));

    return { segments, waypoints };
  },

  nodeToPoint(node) {
    const elevation = text(node, "ele");
    return {
      lat: Number(node.getAttribute("lat")),
      lng: Number(node.getAttribute("lon")),
      elevation: elevation ? Number(elevation) : undefined,
    };
  },

  exportTrack(state) {
    const trksegs = state.segments
      .filter((segment) => segment.points.length)
      .map(
        (segment) =>
          `<trkseg>${segment.points
            .map((point) => `<trkpt lat="${point.lat}" lon="${point.lng}">${ele(point)}</trkpt>`)
            .join("")}</trkseg>`,
      )
      .join("");

    return this.wrap(
      state,
      `${waypointXml(state.waypoints)}<trk><name>${esc(state.project.name)}</name>${trksegs}</trk>`,
    );
  },

  exportRoute(state) {
    const routes = state.segments
      .filter((segment) => segment.points.length)
      .map(
        (segment, index) =>
          `<rte><name>${esc(state.project.name)} ${index + 1}</name>${segment.points
            .map((point) => `<rtept lat="${point.lat}" lon="${point.lng}">${ele(point)}</rtept>`)
            .join("")}</rte>`,
      )
      .join("");
    return this.wrap(state, `${waypointXml(state.waypoints)}${routes}`);
  },

  wrap(state, body) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="TourFlow Map Studio" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${esc(state.project.name)}</name>
    <desc>${esc(state.project.description)}</desc>
    <author><name>${esc(state.project.author)}</name></author>
    <time>${new Date().toISOString()}</time>
  </metadata>
  ${body}
</gpx>`;
  },
};

function waypointXml(waypoints) {
  return waypoints
    .map(
      (waypoint) =>
        `<wpt lat="${waypoint.lat}" lon="${waypoint.lng}"><name>${esc(
          waypoint.title,
        )}</name><desc>${esc(waypoint.description || "")}</desc><type>${esc(
          waypoint.type,
        )}</type></wpt>`,
    )
    .join("");
}

function ele(point) {
  return Number.isFinite(point.elevation) ? `<ele>${point.elevation}</ele>` : "";
}

function text(node, selector) {
  return node.querySelector(selector)?.textContent?.trim() || "";
}

function normalizeType(type) {
  const normalized = String(type).toLowerCase();
  if (["start", "finish", "fuel", "food", "camp", "warning"].includes(normalized)) {
    return normalized;
  }
  return "warning";
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

window.GPX = GPX;
