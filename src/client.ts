import { chmod, lstat, mkdir, open, readFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

export const defaultSite = "https://iconslibrary.com";
const token = /^il_[A-Za-z0-9_-]{43}$/;
type Credential = {
  site: string;
  credentialId: string;
  secret: string;
  refreshToken: string;
  packageToken?: string;
  expiresAt: number;
};

export function validateEndpoint(endpoint: string) {
  const url = new URL(endpoint);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/")
    throw Error("Specify a website origin without a path or credentials.");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))
    throw Error("HTTPS is required.");
  return url.origin;
}

export function fileCredentialStorage(directory = join(homedir(), ".config", "iconslibrary")) {
  const path = join(directory, "developer-access.json");
  return {
    async save(value: Credential) {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      if (!(await lstat(directory)).isDirectory()) throw Error("UNSAFE_CREDENTIAL_DIRECTORY");
      await chmod(directory, 0o700);
      const temporary = join(directory, `.access-${randomUUID()}`);
      const file = await open(temporary, "wx", 0o600);
      try { await file.writeFile(JSON.stringify(value)); }
      finally { await file.close(); }
      await rename(temporary, path);
    },
    async load(): Promise<Credential> {
      const file = await lstat(path);
      if (!file.isFile() || (file.mode & 0o077) !== 0) throw Error("UNSAFE_CREDENTIAL_FILE");
      return JSON.parse(await readFile(path, "utf8"));
    },
  };
}

type Storage = ReturnType<typeof fileCredentialStorage>;
async function device(site: string, operation: string, params: Record<string, unknown>) {
  const response = await fetch(site + "/api/product", {
    method: "POST",
    headers: { origin: site, "content-type": "application/json" },
    body: JSON.stringify({ operation, ...params }),
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw Error(`Developer sign-in unavailable (HTTP ${response.status}).`);
  return response.json();
}

function credential(site: string, result: any, prior?: Credential): Credential {
  const { credentialId = prior?.credentialId, secret, refreshToken, expiresAt, packageToken = prior?.packageToken } = result;
  if (!token.test(secret) || !token.test(refreshToken) || typeof credentialId !== "string" ||
      !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() || (packageToken && !token.test(packageToken)))
    throw Error("Invalid developer sign-in response.");
  return { site, credentialId, secret, refreshToken, expiresAt, ...(packageToken ? { packageToken } : {}) };
}

export async function login(origin: string, store: Storage, options: {
  open: (url: string) => Promise<void>;
  show: (message: string) => void;
  readKits: boolean;
}) {
  const site = validateEndpoint(origin);
  const start = await device(site, "developer-device-start", { readKits: options.readKits });
  const verification = new URL(start.verificationUri);
  if (verification.origin !== site || verification.username || verification.password ||
      verification.pathname !== "/account/developer-access/authorize" ||
      !/^[A-F0-9]{16}$/.test(start.userCode) || !token.test(start.deviceCode) ||
      !Number.isSafeInteger(start.interval) || start.interval < 1 ||
      !Number.isSafeInteger(start.expiresAt) || start.expiresAt > Date.now() + 11 * 60_000)
    throw Error("Invalid developer approval request.");
  options.show(`Authorise this computer at ${verification.href}\nConfirm code: ${start.userCode}`);
  await options.open(verification.href);
  let interval = start.interval;
  while (Date.now() < start.expiresAt) {
    await delay(interval * 1000);
    const result = await device(site, "developer-device-poll", { deviceCode: start.deviceCode });
    if (result.status === "approved") {
      await store.save(credential(site, result));
      options.show("Developer device authorised. Credentials saved privately.");
      return;
    }
    if (result.status === "slow_down") interval += 5;
    else if (result.status !== "pending") throw Error("Device sign-in was not approved.");
  }
  throw Error("Device sign-in expired.");
}

export async function packageCredential(store: Storage) {
  let saved = await store.load();
  const site = validateEndpoint(saved.site);
  if (saved.expiresAt <= Date.now() + 30000) {
    const result = await device(site, "developer-device-refresh", { refreshToken: saved.refreshToken });
    saved = credential(site, result, saved);
    await store.save(saved);
  }
  return { site, secret: saved.secret };
}
