import { createHash } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { join, sep } from "node:path";

export const checksum = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
export const hashes = /^[a-f0-9]{64}$/;
export const localName = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;
export const localPath = (name: string) =>
  typeof name === "string" &&
  name
    .split("/")
    .every(
      (part) =>
        /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part) &&
        part !== "." &&
        part !== "..",
    );

export type Install = {
  name: string;
  record: any;
  files: Map<string, Uint8Array>;
};
const absent = (error: unknown) =>
  (error as NodeJS.ErrnoException).code === "ENOENT";
async function exists(path: string) {
  try {
    return await lstat(path);
  } catch (error) {
    if (absent(error)) return undefined;
    throw error;
  }
}
export const equal = (a: any, b: any): boolean =>
  a === b ||
  Boolean(
    a &&
      b &&
      typeof a === "object" &&
      typeof b === "object" &&
      Object.keys(a).length === Object.keys(b).length &&
      Object.keys(a).every(
        (key) => Object.hasOwn(b, key) && equal(a[key], b[key]),
      ),
  );

export async function project(
  cwd: string,
  task: (entries: Record<string, any>) => Promise<Install[]>,
  reinstall = false,
) {
  const root = join(cwd, "iconslibrary"),
    manifest = join(root, "manifest.json");
  const previous = await exists(root);
  if (previous && (!previous.isDirectory() || previous.isSymbolicLink()))
    throw Error("Unsafe iconslibrary directory.");
  if (!previous) await mkdir(root);
  const lock = join(root, ".install-lock");
  await mkdir(lock).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw Error("Another IconsLibrary install is in progress.");
    throw error;
  });
  const created: string[] = [],
    dirs: string[] = [];
  let stage: string | undefined;
  let committed = false;
  try {
    const manifestInfo = await exists(manifest);
    if (manifestInfo && !manifestInfo.isFile())
      throw Error("Unsafe project manifest.");
    const old = manifestInfo && JSON.parse(await readFile(manifest, "utf8"));
    if (
      old &&
      old.schemaVersion !== 2 &&
      !(
        old.file === "lasso-gradient.svg" &&
        old.selection?.masterId &&
        hashes.test(old.sha256)
      )
    )
      throw Error("Unrecognised project manifest.");
    const entries: Record<string, any> = Object.assign(
      Object.create(null),
      old?.entries,
    );
    if (old && old.schemaVersion !== 2)
      entries["lasso-gradient"] = {
        kind: "drawing",
        key: checksum(
          Buffer.from(
            JSON.stringify([
              old.selection.styleId,
              old.selection.conceptId,
              old.selection.expressionId,
            ]),
          ),
        ).slice(0, 24),
        release: old.release,
        selection: old.selection,
        masterVersion: old.masterVersion,
        assetVersion: old.assetVersion,
        adapter: {
          id: old.adapter.id,
          format: old.adapter.format,
          version: old.adapter.version,
        },
        files: { [old.file]: old.sha256 },
      };
    const installs = await task(entries);
    const manifestPaths = Object.values(entries).flatMap((record) =>
      Object.keys(record.files),
    );
    const allPaths = new Set(manifestPaths.map((path) => path.toLowerCase()));
    stage = await mkdtemp(join(root, ".install-"));
    for (const { name, record, files } of installs) {
      if (!localName.test(name))
        throw Error(
          "Choose a local name using letters, numbers, hyphens or underscores.",
        );
      if (
        reinstall
          ? !equal(entries[name], record)
          : Object.keys(entries).some(
              (key) => key.toLowerCase() === name.toLowerCase(),
            )
      )
        throw Error(
          reinstall
            ? `Recorded delivery changed: ${name}.`
            : `Local name already installed: ${name}.`,
        );
      for (const [path, bytes] of files) {
        if (
          !localPath(path) ||
          path.toLowerCase() === "manifest.json" ||
          (!reinstall && allPaths.has(path.toLowerCase()))
        )
          throw Error(`File collision: ${path}.`);
        allPaths.add(path.toLowerCase());
        const destination = join(root, path);
        let parent = root;
        for (const piece of path.split("/").slice(0, -1)) {
          parent += sep + piece;
          const info = await exists(parent);
          if (info && !info.isDirectory())
            throw Error(`Unsafe installation path: ${path}.`);
          if (!info) {
            await mkdir(parent);
            dirs.push(parent);
          }
        }
        const info = await exists(destination);
        if (info) {
          if (
            reinstall &&
            info.isFile() &&
            checksum(await readFile(destination)) === checksum(bytes)
          )
            continue;
          throw Error(`File collision: ${path}.`);
        }
        const staged = join(stage, String(created.length));
        await writeFile(staged, bytes);
        await link(staged, destination);
        created.push(destination);
      }
      entries[name] = record;
    }
    const stagedManifest = join(stage, "manifest.json");
    await writeFile(
      stagedManifest,
      JSON.stringify({ schemaVersion: 2, entries }, null, 2) + "\n",
    );
    await rename(stagedManifest, manifest);
    committed = true;
  } finally {
    if (!committed) {
      for (const file of created) await rm(file, { force: true });
      for (const dir of dirs.reverse()) await rmdir(dir);
    }
    if (stage) await rm(stage, { recursive: true, force: true });
    await rmdir(lock);
    if (!previous && !committed) await rmdir(root);
  }
}
