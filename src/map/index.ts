import { createKakaoMapAdapter } from "./adapter";
import type { MapAdapter } from "./types";

export function createMapAdapter(): MapAdapter {
  return createKakaoMapAdapter();
}

export type { MapAdapter, MapProvider, MapRuntimeStatus, ProjectRenderCallbacks, ProjectRenderInfo } from "./types";
