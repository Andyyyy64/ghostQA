/**
 * Screenshot coordinate scaling for Anthropic Computer Use API.
 *
 * API constraints (computer_20251124):
 * - Max long edge: 1568px
 * - Max total pixels: ~1,191,922 (1.15 megapixels)
 *
 * If the display exceeds these limits, screenshots are scaled down
 * and coordinates from the API must be scaled back up.
 */

const MAX_LONG_EDGE = 1568;
const MAX_PIXELS = 1_191_922; // ~1.15 MP

export interface ScaleInfo {
  /** Factor to scale screenshot down (< 1 means shrinking) */
  scaleFactor: number;
  /** Dimensions to resize screenshots to before sending to API */
  apiWidth: number;
  apiHeight: number;
  /** Original display dimensions */
  displayWidth: number;
  displayHeight: number;
}

/**
 * Calculate scale factor for a given display size.
 * Returns 1.0 if no scaling is needed.
 */
export function calculateScale(width: number, height: number): ScaleInfo {
  let scaleFactor = 1.0;

  const longEdge = Math.max(width, height);
  if (longEdge > MAX_LONG_EDGE) {
    scaleFactor = MAX_LONG_EDGE / longEdge;
  }

  // Also check total pixel count
  const scaledW = Math.floor(width * scaleFactor);
  const scaledH = Math.floor(height * scaleFactor);
  const totalPixels = scaledW * scaledH;

  if (totalPixels > MAX_PIXELS) {
    const pixelScale = Math.sqrt(MAX_PIXELS / totalPixels);
    scaleFactor *= pixelScale;
  }

  const apiWidth = Math.floor(width * scaleFactor);
  const apiHeight = Math.floor(height * scaleFactor);

  return {
    scaleFactor,
    apiWidth,
    apiHeight,
    displayWidth: width,
    displayHeight: height,
  };
}

/**
 * Scale API coordinates back to display coordinates.
 * The API returns coordinates in the scaled-down image space;
 * we need to convert them to the real display space.
 */
export function scaleToDisplay(
  scale: ScaleInfo,
  apiX: number,
  apiY: number
): [number, number] {
  if (scale.scaleFactor >= 1.0) return [apiX, apiY];
  return [
    Math.round(apiX / scale.scaleFactor),
    Math.round(apiY / scale.scaleFactor),
  ];
}

/**
 * Scale display coordinates to API coordinates.
 */
export function scaleToApi(
  scale: ScaleInfo,
  displayX: number,
  displayY: number
): [number, number] {
  if (scale.scaleFactor >= 1.0) return [displayX, displayY];
  return [
    Math.round(displayX * scale.scaleFactor),
    Math.round(displayY * scale.scaleFactor),
  ];
}
