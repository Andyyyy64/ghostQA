# Reporter

## Overview

The Reporter generates human-readable HTML reports and machine-readable JSON summaries from pipeline results.

**File:** `packages/core/src/reporter/reporter.ts`

## API

```typescript
const reporter = new Reporter(outputDir);

// Single run
const verdict = reporter.determineVerdict(discoveries);
await reporter.writeJson(result);
const reportPath = await reporter.writeHtml(result);

// Comparison
const reportPath = await reporter.writeComparisonHtml(comparison);
```

## Verdict Logic

`determineVerdict(discoveries: Discovery[]): Verdict`

| Discovery Severity | Verdict |
|-------------------|---------|
| Any `critical` or `high` | `"fail"` |
| Any `medium` (no critical/high) | `"warn"` |
| Only `low` / `info` / none | `"pass"` |

## JSON Output

`writeJson(result: RunResult)` writes `summary.json`:

```json
{
  "run_id": "run-abc123",
  "verdict": "fail",
  "started_at": 1709420000000,
  "finished_at": 1709420300000,
  "config": { ... },
  "diff_analysis": {
    "summary": "Changed login form validation",
    "files_changed": 3,
    "impact_areas": 2
  },
  "explorer": {
    "steps_taken": 25,
    "pages_visited": 6,
    "discoveries": [ ... ]
  },
  "cost": {
    "total_usd": 0.45,
    "input_tokens": 15000,
    "output_tokens": 5000,
    "is_rate_limited": false
  },
  "discoveries": [ ... ]
}
```

## Single Run HTML Report

`writeHtml(result)` generates `report.html` — a self-contained dark-themed HTML file.

### Design

- Background: `#0a0a0a`
- Text: `#e5e5e5`
- Font: system font stack
- Max width: 900px, centered
- All styles inlined (no external CSS)

### Sections

**1. Header**

- "ghostQA Report" title

**2. Verdict Card**

- Colored circle indicator: green (pass), red (fail), amber (warn)
- Large verdict text: PASS / FAIL / WARN
- Run ID display

**3. Stats Grid** (2x2 cards)

| Card | Content |
|------|---------|
| Diff | Files changed, impact areas identified |
| Explorer | Steps taken, pages visited |
| Cost | USD amount, or "Rate limited" with guidance text |

Cost display logic:

- If `is_rate_limited`: shows "Rate limited" + "check claude -> /usage | codex -> /status"
- Otherwise: shows `$X.XXXX`

**4. Discoveries**

Each discovery rendered as a card with:

- Severity badge (colored left border):
  - Critical: `#dc2626` (red)
  - High: `#ea580c` (orange-red)
  - Medium: `#d97706` (amber)
  - Low: `#2563eb` (blue)
  - Info: `#6b7280` (gray)
- Title and source label (Explorer / Console)
- Description text
- Expandable `<details>` sections for:
  - Steps to reproduce
  - Console errors
  - Screenshot (as `<img>` tag)

**5. Diff Summary**

Text block showing the AI-generated diff analysis summary.

## Comparison HTML Report

`writeComparisonHtml(comparison)` generates a comparison report.

### Sections

**1. Header**

- "ghostQA Comparison Report"
- `base_ref` → `head_ref` display

**2. Verdict Card**

- Same color scheme as single run
- Shows counts: "N new issues, M fixed"

**3. Stats Grid** (2x2 cards)

| Card | Content |
|------|---------|
| Test Regressions | Count (red if > 0) |
| Tests Fixed | Count (green if > 0) |
| Console Errors | `base → head (delta)` with color |
| Cost | Total USD for both runs |

**4. Before / After Table**

HTML table comparing base and head:

| Metric | Base | Head |
|--------|------|------|
| Explorer Steps | count | count |
| Discoveries | count | count |


**5. New Issues**

Each new discovery with red `NEW` badge and severity indicator.

**6. Fixed Issues**

Each fixed discovery with green `FIXED` badge.

**7. Visual Diff Gallery**

3-column grid for each page with visual changes:

```
┌──────────┬──────────┬──────────┐
│   Base   │   Diff   │   Head   │
│  (image) │(heatmap) │  (image) │
└──────────┴──────────┴──────────┘
        page-name (X.X% changed)
```

Images are embedded as `file://` URLs pointing to the local screenshot files.

## HTML Escaping

All user-provided content (titles, descriptions, URLs) is escaped via `escapeHtml()`:

```
& → &amp;
< → &lt;
> → &gt;
" → &quot;
```
