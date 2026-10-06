// Separate from Blume card.ts: it imports the Takumi native binding at load,
// which would drag the renderer into every page render and prerender/SSR bundles.
export const OG_IMAGE_WIDTH = 1200;
export const OG_IMAGE_HEIGHT = 630;
export const OG_IMAGE_TYPE = "image/png";
