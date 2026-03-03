import { describe, it, expect } from "vitest";
import { parseDiffOutput } from "../src/diff-analyzer/parser";

const SAMPLE_DIFF = `diff --git a/src/app.ts b/src/app.ts
index abc1234..def5678 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -10,6 +10,8 @@ function main() {
   console.log("hello");
+  console.log("new line 1");
+  console.log("new line 2");
   return true;
-  // old comment
 }`;

const MULTI_FILE_DIFF = `diff --git a/file1.ts b/file1.ts
index 1111111..2222222 100644
--- a/file1.ts
+++ b/file1.ts
@@ -1,3 +1,4 @@
 line1
+added
 line2
diff --git a/file2.ts b/file2.ts
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/file2.ts
@@ -0,0 +1,2 @@
+new file content
+second line`;

describe("parseDiffOutput", () => {
  it("parses a single file diff", () => {
    const files = parseDiffOutput(SAMPLE_DIFF);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("src/app.ts");
    expect(files[0].status).toBe("modified");
    expect(files[0].additions).toBe(2);
    expect(files[0].deletions).toBe(1);
  });

  it("parses multiple files", () => {
    const files = parseDiffOutput(MULTI_FILE_DIFF);
    expect(files).toHaveLength(2);
    expect(files[0].path).toBe("file1.ts");
    expect(files[0].status).toBe("modified");
    expect(files[1].path).toBe("file2.ts");
    expect(files[1].status).toBe("added");
  });

  it("detects added files", () => {
    const files = parseDiffOutput(MULTI_FILE_DIFF);
    const added = files.find((f) => f.path === "file2.ts");
    expect(added?.status).toBe("added");
    expect(added?.additions).toBe(2);
    expect(added?.deletions).toBe(0);
  });

  it("returns empty for empty input", () => {
    expect(parseDiffOutput("")).toEqual([]);
  });

  it("includes patch content", () => {
    const files = parseDiffOutput(SAMPLE_DIFF);
    expect(files[0].patch).toContain('+  console.log("new line 1")');
  });
});
