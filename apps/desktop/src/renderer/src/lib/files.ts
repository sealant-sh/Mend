/**
 * A flat, sorted path listing (the server's shape) nested into a directory
 * tree for the Files pane. Directories come first at every level, then
 * files, both in the server's byte order; a path is split on "/" only.
 */

export interface FileNode {
  readonly name: string;
  readonly path: string;
  readonly kind: "dir" | "file";
  readonly children: ReadonlyArray<FileNode>;
  /** Files under this directory, transitively — the count the row shows. */
  readonly fileCount: number;
}

interface MutableDir {
  readonly name: string;
  readonly path: string;
  readonly dirs: Map<string, MutableDir>;
  readonly files: Array<string>;
}

const freeze = (dir: MutableDir): FileNode => {
  const dirs = [...dir.dirs.values()].map(freeze);
  const files = dir.files.map<FileNode>((name) => ({
    name,
    path: dir.path === "" ? name : `${dir.path}/${name}`,
    kind: "file",
    children: [],
    fileCount: 1,
  }));
  return {
    name: dir.name,
    path: dir.path,
    kind: "dir",
    children: [...dirs, ...files],
    fileCount: dirs.reduce((total, child) => total + child.fileCount, 0) + files.length,
  };
};

/** Nest `paths` under an unnamed root; the root's children are the top level. */
export const buildFileTree = (paths: ReadonlyArray<string>): FileNode => {
  const root: MutableDir = { name: "", path: "", dirs: new Map(), files: [] };
  for (const path of paths) {
    const parts = path.split("/").filter((part) => part !== "");
    const name = parts.pop();
    if (name === undefined) continue;
    let cursor = root;
    for (const part of parts) {
      let next = cursor.dirs.get(part);
      if (next === undefined) {
        next = {
          name: part,
          path: cursor.path === "" ? part : `${cursor.path}/${part}`,
          dirs: new Map(),
          files: [],
        };
        cursor.dirs.set(part, next);
      }
      cursor = next;
    }
    cursor.files.push(name);
  }
  return freeze(root);
};

/** Every directory path that contains `path` (for opening a tree to a file). */
export const ancestorsOf = (path: string): ReadonlyArray<string> => {
  const parts = path.split("/");
  parts.pop();
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
};
