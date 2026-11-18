#!/usr/bin/env node
import {
  login,
  defaultSite,
  fileCredentialStorage,
  validateEndpoint,
} from "./client";
import { runDelivery } from "./install";
import { readFile, open as openFile, rename, lstat } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
const args = process.argv.slice(2),
  option = (key: string) =>
    args.find((x) => x.startsWith(`--${key}=`))?.slice(key.length + 3);
async function configureNpm(
  registry: string,
  token: string,
  path = join(homedir(), ".npmrc"),
) {
  const url = new URL(registry);
  validateEndpoint(url.origin);
  if (
    !url.pathname.endsWith("/") ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw Error("INVALID_REGISTRY_URL");
  const prefix = `//${url.host}${url.pathname}`;
  let current = "";
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error("UNSAFE_NPMRC");
    current = await readFile(path, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  const lines = current
    .split("\n")
    .filter(
      (line) =>
        !line.startsWith("@iconslibrary-pro:registry=") &&
        !line.startsWith(prefix + ":_authToken="),
    );
  lines.push(
    `@iconslibrary-pro:registry=${url.href}`,
    `${prefix}:_authToken=${token}`,
  );
  const temp = join(dirname(path), ".iconslibrary-npmrc-" + randomUUID()),
    file = await openFile(temp, "wx", 0o600);
  try {
    await file.writeFile(lines.filter(Boolean).join("\n") + "\n");
  } finally {
    await file.close();
  }
  await rename(temp, path);
}
const open = (url: string) =>
  new Promise<void>((resolve, reject) => {
    const cmd =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "rundll32"
          : "xdg-open";
    const child = spawn(
      cmd,
      process.platform === "win32"
        ? ["url.dll,FileProtocolHandler", url]
        : [url],
      { stdio: "ignore" },
    );
    child.once("error", reject);
    child.once("close", () => resolve());
  });
async function main() {
  if (
    ["search", "inspect", "add", "kit", "motion", "reinstall"].includes(args[0])
  ) {
    await runDelivery(
      args[0],
      args.slice(1).filter((arg) => !arg.startsWith("--")),
      option,
      args.includes("--json"),
    );
    return;
  }
  if (args[0] !== "login") {
    console.log(
      "Usage: iconslibrary login [--kits] [--no-open]\n" +
        "       iconslibrary search QUERY [--family=FAMILY] [--json]\n" +
        "       iconslibrary inspect KEY[:MASTER] [--effect=EFFECT|--pair=PAIR] [--json]\n" +
        "       iconslibrary add KEY[:MASTER]=NAME ... [--format=svg|png]\n" +
        "       iconslibrary kit ID [--as=NAME] [--version=VERSION]\n" +
        "       iconslibrary motion KEY[:MASTER] --effect=EFFECT|--pair=PAIR [--as=NAME] [--format=FORMAT]\n" +
        "       iconslibrary reinstall [NAME ...]",
    );
    if (args.length && !["--help", "-h"].includes(args[0]))
      process.exitCode = 1;
    return;
  }
  const endpoint = option("site") ?? process.env.ICONSLIBRARY_SITE_URL ?? defaultSite,
    registry = option("registry") ?? process.env.ICONSLIBRARY_REGISTRY_URL;
  validateEndpoint(endpoint);
  if (registry) validateEndpoint(new URL(registry).origin);
  const store = fileCredentialStorage();
  await login(endpoint, store, {
    show: console.log,
    open: args.includes("--no-open") ? async () => {} : open,
    readKits: args.includes("--kits"),
  });
  if (!registry) return;
  const credential = await store.load();
  if (!credential.packageToken) throw Error("PACKAGE_CREDENTIAL_NOT_ISSUED");
  await configureNpm(registry, credential.packageToken);
  console.log(
    "Pro package access configured. Install @iconslibrary-pro/react with npm.",
  );
}
if (
  import.meta.url ===
  (process.argv[1] ? pathToFileURL(realpathSync(process.argv[1])).href : "")
)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
export { configureNpm };
