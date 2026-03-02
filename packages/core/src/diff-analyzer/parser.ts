import type { DiffFile } from "../types/impact";

export function parseDiffOutput(diffOutput: string): DiffFile[] {
  const files: DiffFile[] = [];
  const fileSections = diffOutput.split(/^diff --git /m).filter(Boolean);

  for (const section of fileSections) {
    const lines = section.split("\n");
    const headerMatch = lines[0].match(/a\/(.+?) b\/(.+)/);
    if (!headerMatch) continue;

    const oldPath = headerMatch[1];
    const newPath = headerMatch[2];

    let status: DiffFile["status"] = "modified";
    if (section.includes("new file mode")) {
      status = "added";
    } else if (section.includes("deleted file mode")) {
      status = "deleted";
    } else if (oldPath !== newPath) {
      status = "renamed";
    }

    let additions = 0;
    let deletions = 0;
    const patchLines: string[] = [];
    let inPatch = false;

    for (const line of lines) {
      if (line.startsWith("@@")) {
        inPatch = true;
      }
      if (inPatch) {
        patchLines.push(line);
        if (line.startsWith("+") && !line.startsWith("+++")) additions++;
        if (line.startsWith("-") && !line.startsWith("---")) deletions++;
      }
    }

    files.push({
      path: newPath,
      status,
      additions,
      deletions,
      patch: patchLines.join("\n"),
    });
  }

  return files;
}
