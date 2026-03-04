import { describe, it, expect } from "vitest";
import {
  calculateScale,
  scaleToDisplay,
  scaleToApi,
} from "../src/explorer/screenshot-scaler";

describe("calculateScale", () => {
  it("returns scale 1.0 for small display", () => {
    const info = calculateScale(1280, 720);
    expect(info.scaleFactor).toBe(1.0);
    expect(info.apiWidth).toBe(1280);
    expect(info.apiHeight).toBe(720);
  });

  it("scales down when long edge exceeds 1568px", () => {
    const info = calculateScale(1920, 1080);
    expect(info.scaleFactor).toBeLessThan(1.0);
    expect(info.apiWidth).toBeLessThanOrEqual(1568);
    expect(info.apiHeight).toBeLessThanOrEqual(1568);
    expect(info.displayWidth).toBe(1920);
    expect(info.displayHeight).toBe(1080);
  });

  it("scales down 2560x1440 display", () => {
    const info = calculateScale(2560, 1440);
    expect(info.scaleFactor).toBeLessThan(1.0);
    expect(info.apiWidth).toBeLessThanOrEqual(1568);
  });

  it("handles portrait orientation", () => {
    const info = calculateScale(1080, 1920);
    expect(info.scaleFactor).toBeLessThan(1.0);
    expect(info.apiHeight).toBeLessThanOrEqual(1568);
  });

  it("handles exact boundary (1568px long edge)", () => {
    const info = calculateScale(1568, 720);
    expect(info.scaleFactor).toBe(1.0);
    expect(info.apiWidth).toBe(1568);
  });

  it("respects total pixel limit", () => {
    // 1568x1568 = 2,458,624 pixels > 1,191,922
    const info = calculateScale(1568, 1568);
    expect(info.scaleFactor).toBeLessThan(1.0);
    const totalPixels = info.apiWidth * info.apiHeight;
    expect(totalPixels).toBeLessThanOrEqual(1_191_922);
  });
});

describe("scaleToDisplay", () => {
  it("returns same coordinates when no scaling needed", () => {
    const info = calculateScale(1280, 720);
    const [x, y] = scaleToDisplay(info, 500, 300);
    expect(x).toBe(500);
    expect(y).toBe(300);
  });

  it("scales up coordinates from API space to display space", () => {
    const info = calculateScale(1920, 1080);
    const [x, y] = scaleToDisplay(info, 100, 100);
    // API coords should be scaled up
    expect(x).toBeGreaterThan(100);
    expect(y).toBeGreaterThan(100);
  });

  it("maps origin correctly", () => {
    const info = calculateScale(1920, 1080);
    const [x, y] = scaleToDisplay(info, 0, 0);
    expect(x).toBe(0);
    expect(y).toBe(0);
  });
});

describe("scaleToApi", () => {
  it("returns same coordinates when no scaling needed", () => {
    const info = calculateScale(1280, 720);
    const [x, y] = scaleToApi(info, 500, 300);
    expect(x).toBe(500);
    expect(y).toBe(300);
  });

  it("scales down coordinates from display to API space", () => {
    const info = calculateScale(1920, 1080);
    const [x, y] = scaleToApi(info, 1920, 1080);
    // Allow +-1 pixel rounding
    expect(x).toBeLessThanOrEqual(info.apiWidth + 1);
    expect(y).toBeLessThanOrEqual(info.apiHeight + 1);
  });

  it("round-trips correctly", () => {
    const info = calculateScale(1920, 1080);
    const origX = 960;
    const origY = 540;
    const [apiX, apiY] = scaleToApi(info, origX, origY);
    const [dispX, dispY] = scaleToDisplay(info, apiX, apiY);
    // Allow +-1 pixel rounding error
    expect(Math.abs(dispX - origX)).toBeLessThanOrEqual(1);
    expect(Math.abs(dispY - origY)).toBeLessThanOrEqual(1);
  });
});
