/**
 * Visual Diff e2e test.
 *
 * Creates real PNG images, runs compareVisual(), verifies:
 * - Identical images produce no diff entries
 * - Different images produce a diff entry with heatmap
 * - Diff percentage is calculated correctly
 * - Heatmap PNG file is written to disk
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PNG } from "pngjs";
import { Comparator } from "../src/comparator/comparator";

/** Create a solid-color 100x100 PNG and return as Buffer */
function makePng(r: number, g: number, b: number): Buffer {
  const width = 100;
  const height = 100;
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) << 2;
      png.data[idx] = r;
      png.data[idx + 1] = g;
      png.data[idx + 2] = b;
      png.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

/** Create a 100x100 PNG with a colored rectangle in the center */
function makePngWithRect(
  bgR: number, bgG: number, bgB: number,
  rectR: number, rectG: number, rectB: number,
  rectX = 20, rectY = 20, rectW = 60, rectH = 60
): Buffer {
  const width = 100;
  const height = 100;
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (width * y + x) << 2;
      const inRect = x >= rectX && x < rectX + rectW && y >= rectY && y < rectY + rectH;
      png.data[idx] = inRect ? rectR : bgR;
      png.data[idx + 1] = inRect ? rectG : bgG;
      png.data[idx + 2] = inRect ? rectB : bgB;
      png.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

describe("visual diff e2e", () => {
  let tmpDir: string;
  let baseDir: string;
  let headDir: string;
  let diffDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ghostqa-vdiff-"));
    baseDir = join(tmpDir, "base");
    headDir = join(tmpDir, "head");
    diffDir = join(tmpDir, "diff");
    await mkdir(join(baseDir, "screenshots"), { recursive: true });
    await mkdir(join(headDir, "screenshots"), { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("reports no diffs for identical images", async () => {
    const img = makePng(255, 255, 255);
    await writeFile(join(baseDir, "screenshots", "page1.png"), img);
    await writeFile(join(headDir, "screenshots", "page1.png"), img);

    const comparator = new Comparator();
    const diffs = await comparator.compareVisual(baseDir, headDir, diffDir);

    expect(diffs).toHaveLength(0);
  });

  it("detects diff when images differ significantly", async () => {
    // Base: white image
    const baseImg = makePng(255, 255, 255);
    // Head: black image (100% different)
    const headImg = makePng(0, 0, 0);

    await writeFile(join(baseDir, "screenshots", "page1.png"), baseImg);
    await writeFile(join(headDir, "screenshots", "page1.png"), headImg);

    const comparator = new Comparator();
    const diffs = await comparator.compareVisual(baseDir, headDir, diffDir);

    expect(diffs).toHaveLength(1);
    expect(diffs[0].page_url).toBe("page1");
    expect(diffs[0].diff_percent).toBeGreaterThan(50);
  });

  it("writes heatmap PNG to diff output dir", async () => {
    const baseImg = makePng(255, 0, 0); // red
    const headImg = makePng(0, 0, 255); // blue

    await writeFile(join(baseDir, "screenshots", "page1.png"), baseImg);
    await writeFile(join(headDir, "screenshots", "page1.png"), headImg);

    const comparator = new Comparator();
    const diffs = await comparator.compareVisual(baseDir, headDir, diffDir);

    expect(diffs).toHaveLength(1);

    // Verify heatmap file exists and is a valid PNG
    const heatmapPath = diffs[0].diff_image;
    const heatmapStat = await stat(heatmapPath);
    expect(heatmapStat.size).toBeGreaterThan(100);

    // Verify it's a valid PNG by reading it back
    const heatmapBuf = await readFile(heatmapPath);
    const heatmapPng = PNG.sync.read(heatmapBuf);
    expect(heatmapPng.width).toBe(100);
    expect(heatmapPng.height).toBe(100);
  });

  it("calculates partial diff percentage correctly", async () => {
    // Base: white bg, no rect
    const baseImg = makePng(255, 255, 255);
    // Head: white bg with red center rect (60x60 out of 100x100 = 36%)
    const headImg = makePngWithRect(255, 255, 255, 255, 0, 0);

    await writeFile(join(baseDir, "screenshots", "page1.png"), baseImg);
    await writeFile(join(headDir, "screenshots", "page1.png"), headImg);

    const comparator = new Comparator();
    const diffs = await comparator.compareVisual(baseDir, headDir, diffDir);

    expect(diffs).toHaveLength(1);
    // The diff should be roughly 36% (60x60 = 3600 pixels out of 10000)
    expect(diffs[0].diff_percent).toBeGreaterThan(20);
    expect(diffs[0].diff_percent).toBeLessThan(50);
  });

  it("only matches screenshots present in both dirs", async () => {
    const img = makePng(255, 255, 255);
    const diffImg = makePng(0, 0, 0);

    // base has page1 and page2, head has only page2 and page3
    await writeFile(join(baseDir, "screenshots", "page1.png"), img);
    await writeFile(join(baseDir, "screenshots", "page2.png"), img);
    await writeFile(join(headDir, "screenshots", "page2.png"), diffImg);
    await writeFile(join(headDir, "screenshots", "page3.png"), img);

    const comparator = new Comparator();
    const diffs = await comparator.compareVisual(baseDir, headDir, diffDir);

    // Only page2 is common and different
    expect(diffs).toHaveLength(1);
    expect(diffs[0].page_url).toBe("page2");
  });

  it("handles empty screenshot directories", async () => {
    const comparator = new Comparator();
    const diffs = await comparator.compareVisual(baseDir, headDir, diffDir);
    expect(diffs).toHaveLength(0);
  });

  it("handles missing screenshot directories gracefully", async () => {
    // Use dirs without screenshots subdir
    const emptyBase = join(tmpDir, "empty-base");
    const emptyHead = join(tmpDir, "empty-head");
    await mkdir(emptyBase, { recursive: true });
    await mkdir(emptyHead, { recursive: true });

    const comparator = new Comparator();
    const diffs = await comparator.compareVisual(emptyBase, emptyHead, diffDir);
    expect(diffs).toHaveLength(0);
  });
});
