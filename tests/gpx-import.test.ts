import assert from "node:assert/strict";
import test from "node:test";
import { parseGpx } from "../src/domain/gpx";
import { installDomParserStub } from "./dom-parser-stub";

installDomParserStub();

test("imports GPX tracks, routes, waypoints, metadata, and Korean waypoint types", () => {
  const result = parseGpx(`
    <gpx version="1.1">
      <metadata><name>서울 &amp; 강원 투어</name></metadata>
      <trk>
        <name>북악 코스</name>
        <trkseg>
          <trkpt lat="37.5" lon="127.0" />
          <trkpt lat="37.6" lon="127.1" />
        </trkseg>
        <trkseg>
          <trkpt lat="37.7" lon="127.2" />
        </trkseg>
      </trk>
      <rte>
        <name>복귀 루트</name>
        <rtept lat="37.8" lon="127.3" />
      </rte>
      <wpt lat="37.55" lon="127.05">
        <name>주유소</name>
        <desc>휴식 지점</desc>
        <type>주유</type>
      </wpt>
    </gpx>
  `);

  assert.equal(result.title, "서울 & 강원 투어");
  assert.equal(result.segments.length, 3);
  assert.equal(result.segments[0].name, "북악 코스");
  assert.equal(result.segments[0].points.length, 2);
  assert.equal(result.segments[1].name, "북악 코스 2");
  assert.equal(result.segments[2].name, "복귀 루트");
  assert.equal(result.segments[2].points[0].lng, 127.3);
  assert.equal(result.waypoints.length, 1);
  assert.equal(result.waypoints[0].type, "fuel");
  assert.equal(result.waypoints[0].title, "주유소");
  assert.equal(result.waypoints[0].description, "휴식 지점");
  assert.equal(result.skippedPoints, 0);
});

test("skips invalid GPX coordinates and rejects empty files", () => {
  const result = parseGpx(`
    <gpx version="1.1">
      <trk><trkseg><trkpt lat="91" lon="127.0" /></trkseg></trk>
      <rte><rtept lat="37.8" lon="190" /></rte>
      <wpt lat="37.55" lon="127.05"><name>주의</name><sym>경고</sym></wpt>
    </gpx>
  `);

  assert.equal(result.segments.length, 0);
  assert.equal(result.waypoints.length, 1);
  assert.equal(result.waypoints[0].type, "warning");
  assert.equal(result.skippedPoints, 2);
  assert.throws(() => parseGpx("<gpx></gpx>"), /경로 또는 웨이포인트/);
});

test("imports GPX with XML namespaces and prefixed tags", () => {
  const result = parseGpx(`
    <gpxx:gpx xmlns:gpxx="http://www.topografix.com/GPX/1/1" version="1.1">
      <gpxx:metadata><gpxx:name>네임스페이스 코스</gpxx:name></gpxx:metadata>
      <gpxx:rte>
        <gpxx:name>접두사 루트</gpxx:name>
        <gpxx:rtept lat="35.1" lon="129.0" />
        <gpxx:rtept lat="35.2" lng="129.1" />
      </gpxx:rte>
      <gpxx:wpt lat="35.15" lon="129.05"><gpxx:sym>camp</gpxx:sym></gpxx:wpt>
    </gpxx:gpx>
  `);

  assert.equal(result.title, "네임스페이스 코스");
  assert.equal(result.segments.length, 1);
  assert.equal(result.segments[0].name, "접두사 루트");
  assert.equal(result.segments[0].points.length, 2);
  assert.equal(result.segments[0].points[1].lng, 129.1);
  assert.equal(result.waypoints[0].type, "camp");
});
