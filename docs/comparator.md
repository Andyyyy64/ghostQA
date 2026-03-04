# Comparator

## Overview

The Comparator compares results from two pipeline runs (base vs head) and produces a structured diff showing what changed — new bugs, fixed bugs, test regressions, visual changes, and behavioral shifts.

**File:** `packages/core/src/comparator/comparator.ts`

## Usage

```typescript
const comparator = new Comparator();

// Compare two RunResult objects
const comparison = comparator.compare(baseResult, headResult, "main", "feature-branch");

// Compare screenshots (optional, may fail if dirs don't exist)
const visualDiffs = await comparator.compareVisual(baseRunDir, headRunDir, diffOutputDir);
```

## Discovery Comparison

`compareDiscoveries(baseDiscoveries, headDiscoveries)`

Matches discoveries by **title** (case-insensitive string comparison):

- **New discoveries**: present in head but not in base → potential regressions
- **Fixed discoveries**: present in base but not in head → improvements

```typescript
const baseTitles = new Set(base.map(d => d.title.toLowerCase()));
const headTitles = new Set(head.map(d => d.title.toLowerCase()));

new_discoveries = head.filter(d => !baseTitles.has(d.title.toLowerCase()));
fixed_discoveries = base.filter(d => !headTitles.has(d.title.toLowerCase()));
```

## Behavioral Diff

`compareBehavioral(baseResult, headResult)`

### Console Errors

Counts `Discovery` objects with `console_errors` field from each run:

```typescript
{
  console_errors: {
    base: <count from base>,
    head: <count from head>,
    delta: head - base
  }
}
```

A positive delta means more console errors in the head version.

### HTTP Failures

Currently hardcoded to `{ base: 0, head: 0, delta: 0 }`. Future work will parse HAR traces to count HTTP 4xx/5xx responses.

## Visual Diff

`compareVisual(baseRunDir, headRunDir, diffOutputDir)`

Pixel-level screenshot comparison using `pixelmatch`.

### Process

1. **List screenshots**: reads `.png` files from `<runDir>/screenshots/` in both base and head
2. **Match by filename**: only compares screenshots that exist in both directories
3. **Read PNGs**: uses `pngjs` to decode images
4. **Skip mismatched dimensions**: if base and head screenshots have different sizes, they are skipped
5. **Pixel diff**: runs `pixelmatch` with threshold `0.1`
6. **Filter noise**: only reports diffs where `diffPercent > 0.5%`
7. **Write heatmap**: saves diff image as PNG to the output directory

### Dependencies

`pixelmatch` and `pngjs` are dynamically imported to avoid hard dependencies:

```typescript
const { default: pixelmatch } = await import("pixelmatch");
const { PNG } = await import("pngjs");
```

### Output

Returns `VisualDiffEntry[]`:

```typescript
{
  page_url: string,        // filename without extension
  base_screenshot: string,  // path to base image
  head_screenshot: string,  // path to head image
  diff_image: string,       // path to heatmap image
  diff_percent: number      // percentage of changed pixels
}
```

### Error Handling

- Missing screenshot directories: returns empty array
- Individual comparison failures: logged and skipped
- Dynamic import failures: returns empty array

## Verdict Determination

`determineVerdict(comparison)`:

| Condition | Verdict |
|-----------|---------|
| Any new discovery with `critical` or `high` severity | `fail` |
| Any new discovery with `medium` severity | `warn` |
| `console_errors.delta > 0` | `warn` |
| None of the above | `pass` |

## ComparisonResult Structure

```typescript
{
  run_id: string,
  verdict: "pass" | "fail" | "warn",
  base_ref: string,
  head_ref: string,
  started_at: number,
  finished_at: number,
  diff_analysis: { summary, files_changed, impact_areas },
  base: { run_id, explorer, discoveries },
  head: { run_id, explorer, discoveries },
  regressions: {
    new_discoveries: Discovery[],
    fixed_discoveries: Discovery[],
    test_regressions: number,
    test_fixes: number
  },
  behavioral: BehavioralDiff,
  visual: { pages_compared, diffs: VisualDiffEntry[] },
  cost: { total_usd, input_tokens, output_tokens, is_rate_limited }
}
```
