import assert from "node:assert/strict";
import test from "node:test";
import { exportGpx } from "../src/domain/gpx";
import type { Project } from "../src/domain/types";

test("exports GPX track with waypoints and escaped metadata", () => {
  const xml = exportGpx(sampleProject(), "track");

  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<gpx version="1\.1" creator="TourMap Editor"/);
  assert.match(xml, /<name>서울 &amp; 강원 &lt;투어&gt;<\/name>/);
  assert.match(xml, /<time>\d{4}-\d{2}-\d{2}T/);
  assert.match(xml, /<wpt lat="37\.55" lon="127\.05"><name>주유 &amp; 휴식<\/name><desc>5분 &lt;정차&gt;<\/desc><type>fuel<\/type><\/wpt>/);
  assert.match(xml, /<trk><name>서울 &amp; 강원 &lt;투어&gt;<\/name><trkseg><trkpt lat="37\.5" lon="127" \/><trkpt lat="37\.6" lon="127\.1" \/><\/trkseg><\/trk>/);
});

test("filters invalid route points and waypoints during export", () => {
  const project = sampleProject();
  project.segments[0].points.push({ id: "bad-point", lat: 99, lng: 127.2 });
  project.waypoints.push({
    id: "bad-waypoint",
    type: "warning",
    lat: 37.7,
    lng: 190,
    title: "잘못된 핀",
  });

  const xml = exportGpx(project, "track");

  assert.doesNotMatch(xml, /bad-point/);
  assert.doesNotMatch(xml, /잘못된 핀/);
  assert.match(xml, /<trkpt lat="37\.5" lon="127" \/>/);
});

function sampleProject(): Project {
  return {
    id: "project-1",
    title: "서울 & 강원 <투어>",
    createdAt: "2026-05-28T00:00:00Z",
    updatedAt: "2026-05-28T00:00:00Z",
    segments: [
      {
        id: "seg-1",
        name: "북악 & 팔당",
        points: [
          { id: "pt-1", lat: 37.5, lng: 127.0 },
          { id: "pt-2", lat: 37.6, lng: 127.1 },
        ],
      },
    ],
    waypoints: [
      {
        id: "wpt-1",
        type: "fuel",
        lat: 37.55,
        lng: 127.05,
        title: "주유 & 휴식",
        description: "5분 <정차>",
      },
    ],
  };
}
