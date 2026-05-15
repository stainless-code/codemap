/**
 * Markers — regex pass over raw source, not AST-driven. Runs as
 * `finalize()` after the shared visitor.
 */

import { extractMarkers } from "../markers";
import type { TierExtractor } from "./types";

export const markersExtractor: TierExtractor = {
  tierId: "markers",
  register() {},
  finalize(ctx) {
    ctx.markers.push(...extractMarkers(ctx.source, ctx.relPath));
  },
};
