export interface DiffFile {
  path: string;
  oldPath: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  lines: string[];
}

function cleanDiffPath(value: string): string {
  const path = value.trim().split("\t")[0];
  if (path === "/dev/null") return path;
  return path.replace(/^[ab]\//, "");
}

export function parseGitDiff(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let current: DiffFile | null = null;

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      current = {
        oldPath: match?.[1] ?? "",
        path: match?.[2] ?? "Unknown file",
        status: "modified",
        additions: 0,
        deletions: 0,
        lines: [line],
      };
      files.push(current);
      continue;
    }

    if (!current) continue;
    current.lines.push(line);

    if (line.startsWith("new file mode")) current.status = "added";
    if (line.startsWith("deleted file mode")) current.status = "deleted";
    if (line.startsWith("rename from ")) {
      current.status = "renamed";
      current.oldPath = line.slice("rename from ".length);
    }
    if (line.startsWith("rename to ")) current.path = line.slice("rename to ".length);
    if (line.startsWith("+++ ")) {
      const path = cleanDiffPath(line.slice(4));
      if (path !== "/dev/null") current.path = path;
    }
    if (line.startsWith("--- ")) {
      const path = cleanDiffPath(line.slice(4));
      if (path !== "/dev/null") current.oldPath = path;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) current.additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) current.deletions += 1;
  }

  return files;
}
