import { svgReceiptStamp } from "./provenance";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { unzipSync } from "fflate";
import {
  fileCredentialStorage,
  packageCredential,
  defaultSite,
  validateEndpoint,
} from "./client";
import {
  checksum,
  equal as same,
  hashes,
  localName,
  localPath,
  project,
  type Install,
} from "./project";

const lassoKey = checksum(
  Buffer.from(
    JSON.stringify([
      "expressive",
      "con_5df161606507d48559f31f48",
      "exp_656bcf4c84458cb7e3b115b2",
    ]),
  ),
).slice(0, 24);
const lassoMaster = "mst_71a9cce334d8ac808734e1fb";
const manifestPath = "iconslibrary-manifest.json";
const id = /^[a-zA-Z0-9_-]{1,128}$/;
const sizeLimit = 128 * 1024 * 1024;
type Part = {
  path: string;
  mediaType: string;
  artifactId: string;
  size: number;
  checksum: string;
};
type Job = {
  jobId: string;
  releaseId: string;
  status: string;
  receiptId: string;
  artifacts?: Part[];
};

function filePart(job: Job, match: (part: Part) => boolean) {
  const parts = job.artifacts?.filter(match);
  const part = parts?.[0];
  if (
    !part ||
    parts.length !== 1 ||
    !id.test(part.artifactId) ||
    !Number.isSafeInteger(part.size) ||
    part.size < 1 ||
    part.size > sizeLimit ||
    !hashes.test(part.checksum)
  )
    throw Error("Invalid delivery file metadata.");
  return part;
}
function verified(expected: any, actual: any) {
  for (const key of ["release", "selection", "masterVersion", "assetVersion"])
    if (!expected[key] || !same(expected[key], actual?.[key]))
      throw Error("Drawing or asset version mismatch.");
}

export async function service() {
  const deployment = process.env.ICONSLIBRARY_DEPLOYMENT_TOKEN;
  if (deployment !== undefined && !/^il_[A-Za-z0-9_-]{43}$/.test(deployment))
    throw Error("Invalid deployment credential.");
  const { site, secret } = deployment
    ? {
        site: process.env.ICONSLIBRARY_SITE_URL ?? defaultSite,
        secret: deployment,
      }
    : await packageCredential(fileCredentialStorage()).catch(() => {
        throw Error(
          "Run iconslibrary login or supply a deployment credential.",
        );
      });
  if (!site)
    throw Error("Run iconslibrary login before using developer delivery.");
  const origin = validateEndpoint(site);
  const authorization = "Bearer " + secret;
  async function post(data: object) {
    const response = await fetch(origin + "/api/product", {
      method: "POST",
      headers: { authorization, origin, "content-type": "application/json" },
      body: JSON.stringify(data),
      redirect: "error",
      signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok) {
      if ("operation" in data && data.operation === "developer-inspect")
        throw Error("Drawing or Motion unavailable.");
      if ("operation" in data && data.operation === "developer-kit")
        throw Error("Kit unavailable for this account or workspace.");
      throw Error(`Developer delivery unavailable (HTTP ${response.status}).`);
    }
    return response.json();
  }
  async function job(request: object, releaseId?: string): Promise<Job> {
    return wait(
      await post({
        operation: "developer-install",
        request: { operationId: randomUUID(), ...request },
      }),
      releaseId,
    );
  }
  async function wait(
    initial: Job,
    releaseId = initial.releaseId,
  ): Promise<Job> {
    let result = initial;
    const first = result.jobId;
    const deadline = Date.now() + 15 * 60_000;
    let interval = 1000;
    for (;;) {
      if (!id.test(result.jobId || "") || result.jobId !== first)
        throw Error("Delivery job mismatch.");
      if (!result.releaseId || result.releaseId !== releaseId)
        throw Error("Catalogue release mismatch.");
      if (
        !/^ilk_[A-Za-z0-9_-]{1,128}$/.test(result.receiptId ?? "") ||
        result.receiptId !== initial.receiptId
      )
        throw Error("Delivery receipt mismatch.");
      if (result.status === "succeeded") return result;
      if (
        !["queued", "running"].includes(result.status) ||
        Date.now() > deadline
      )
        throw Error("The file could not be prepared.");
      await delay(interval);
      interval = Math.min(interval * 2, 5000);
      result = await post({ operation: "job-status", jobId: first });
    }
  }
  async function download(part: Part, job: Pick<Job, "jobId" | "receiptId">) {
    if (
      !id.test(job.jobId) ||
      !id.test(part.artifactId) ||
      !/^ilk_[a-zA-Z0-9_-]{1,128}$/.test(job.receiptId) ||
      !hashes.test(part.checksum) ||
      !Number.isSafeInteger(part.size) ||
      part.size < 1 ||
      part.size > sizeLimit
    )
      throw Error("Invalid recorded delivery.");
    const stamp =
      part.mediaType === "image/svg+xml"
        ? Buffer.from(svgReceiptStamp(job.receiptId, part.checksum))
        : Buffer.alloc(0);
    const bytes = Buffer.alloc(part.size + stamp.length);
    const response = await fetch(
      origin + "/api/delivery/files/" + part.artifactId + "?job=" + job.jobId,
      {
        headers: { authorization, "accept-encoding": "identity" },
        redirect: "error",
        signal: AbortSignal.timeout(90_000),
      },
    );
    const deliveredSha256 = response.headers.get(
      "x-iconslibrary-delivered-sha256",
    );
    const wireLength = response.headers.get("content-length");
    const encoding = response.headers.get("content-encoding");
    if (
      !response.ok ||
      response.headers.get("content-type") !== part.mediaType ||
      ((!encoding || encoding === "identity") &&
        wireLength !== null &&
        wireLength !== String(bytes.length)) ||
      response.headers.get("x-iconslibrary-issuance") !== job.receiptId ||
      response.headers.get("x-iconslibrary-canonical-sha256") !==
        part.checksum ||
      !deliveredSha256 ||
      !hashes.test(deliveredSha256) ||
      !response.body
    )
      throw Error("Invalid download metadata or access denied.");
    const reader = response.body.getReader();
    let offset = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.length > bytes.length) {
        await reader.cancel();
        throw Error("Download size mismatch.");
      }
      bytes.set(value, offset);
      offset += value.length;
    }
    const canonical = bytes.subarray(0, part.size);
    if (
      offset !== bytes.length ||
      checksum(bytes) !== deliveredSha256 ||
      checksum(canonical) !== part.checksum ||
      !bytes.subarray(part.size).equals(stamp)
    )
      throw Error("Download checksum mismatch.");
    return {
      bytes,
      canonical,
      delivery: {
        jobId: job.jobId,
        receiptId: job.receiptId,
        part,
        canonicalSha256: part.checksum,
        deliveredSha256,
      },
    };
  }
  return { post, job, wait, download, origin };
}
type Service = Awaited<ReturnType<typeof service>>;
export type Address = { key: string; masterId?: string; name?: string };
export function address(value: string): Address {
  if (value === "lasso-gradient")
    return { key: lassoKey, masterId: lassoMaster, name: value };
  const match =
    /^([a-f0-9]{24})(?::([^=]+))?(?:=([a-zA-Z0-9][a-zA-Z0-9_-]{0,79}))?$/.exec(
      value ?? "",
    );
  if (!match)
    throw Error(
      "Use a drawing key from search, optionally KEY:MASTER=LOCAL_NAME.",
    );
  return { key: match[1], masterId: match[2], name: match[3] };
}
export async function inspect(
  api: Service,
  source: Address,
  motion?: object,
  workspaceId?: string,
) {
  let data = await api.post({
    operation: "developer-inspect",
    operationId: randomUUID(),
    key: source.key,
    masterId: source.masterId,
    motion,
    workspaceId,
  });
  if (data.jobId) {
    const job = await api.wait(data);
    const { bytes } = await api.download(
      filePart(job, (part) => part.path === "drawing.json"),
      job,
    );
    const inspected = JSON.parse(bytes.toString("utf8"));
    if (inspected.release?.releaseId !== job.releaseId)
      throw Error("Catalogue release mismatch.");
    const key = (selection: any) =>
      JSON.stringify([
        selection.conceptId,
        selection.expressionId,
        selection.styleId,
      ]);
    const links = new Map<string, any>(
      data.links.map((row: any) => [key(row.selection), row]),
    );
    data = {
      ...inspected,
      key: source.key,
      name: data.released.name,
      preview: data.released.preview,
      drawingName:
        inspected.drawingName === "No data"
          ? data.released.name
          : inspected.drawingName,
      alternatives: inspected.alternatives.flatMap((item: any) => {
        const row = links.get(key(item.selection));
        return row ? [{ ...item, key: row.key, preview: row.preview }] : [];
      }),
    };
  }
  return {
    ...data,
    preview: new URL(data.preview, api.origin).href,
    alternatives: data.alternatives.map((item: any) => ({
      ...item,
      preview: new URL(item.preview, api.origin).href,
    })),
  };
}
function identity(drawing: any) {
  return {
    release: drawing.release,
    selection: drawing.selection,
    masterVersion: drawing.masterVersion,
    assetVersion: drawing.assetVersion,
  };
}

async function asset(
  api: Service,
  source: Address,
  workspaceId?: string,
  options: {
    format?: string;
    motion?: any;
    trigger?: string;
    recorded?: any;
  } = {},
): Promise<Install> {
  const drawing = await inspect(api, source, options.motion, workspaceId);
  const name = source.name ?? source.key;
  const still = !options.motion;
  const selected = drawing.selectedMotion;
  const adapter = still
    ? drawing.outputs.find(
        (output: any) => output.format === (options.format ?? "svg"),
      )
    : selected?.outputs.find(
        (output: any) => output.format === (options.format ?? "animated-svg"),
      );
  if (!adapter)
    throw Error("Unsupported drawing, Motion or output combination.");
  const pin = identity(drawing);
  const record: any = {
    kind: still ? "drawing" : "motion",
    key: source.key,
    ...pin,
    adapter: {
      id: adapter.id,
      format: adapter.format,
      version: adapter.version,
    },
    ...(workspaceId ? { workspaceId } : {}),
    ...(!still
      ? {
          motion: selected.plan,
          motionRequest: options.motion,
          trigger: options.trigger ?? "programmatic",
          ...(selected.destination
            ? { destination: selected.destination }
            : {}),
        }
      : {}),
  };
  if (options.recorded) {
    verified(options.recorded, pin);
    if (
      !same(record.adapter, options.recorded.adapter) ||
      !same(record.motion, options.recorded.motion) ||
      !same(record.destination, options.recorded.destination)
    )
      throw Error("Recorded output or Motion version changed.");
  }
  const job = await api.job(
    {
      selection: drawing.selection,
      workspaceId,
      ...(still
        ? { operation: "export", adapter: adapter.id }
        : {
            operation: "motion-export",
            format: adapter.format,
            motion: {
              source: drawing.selection,
              ...options.motion,
              ...(selected.plan.destination
                ? { destination: selected.plan.destination }
                : {}),
            },
          }),
    },
    drawing.release.releaseId,
  );
  const manifest = JSON.parse(
    (
      await api.download(
        filePart(
          job,
          (p) => p.path === manifestPath && p.mediaType === "application/json",
        ),
        job,
      )
    ).bytes.toString("utf8"),
  );
  verified(pin, manifest);
  if (
    still
      ? !same(record.adapter, {
          id: manifest.adapter?.id,
          version: manifest.adapter?.version,
          format: manifest.adapter?.format,
        })
      : !same(record.adapter, manifest.adapter) ||
        !same(
          { ...manifest.motion, reason: selected.plan.reason },
          selected.plan,
        ) ||
        !same(manifest.destination, selected.destination) ||
        (selected.plan.effect === "magic-replace" &&
          manifest.actualEffect !== "magic-replace")
  )
    throw Error("Output or Motion version mismatch.");
  const mime: Record<string, string> = {
    svg: "image/svg+xml",
    png: "image/png",
    "animated-svg": "image/svg+xml",
    apng: "image/apng",
    gif: "image/gif",
    webm: "video/webm",
  };
  const expectedMime = mime[adapter.format];
  const output = filePart(
    job,
    (part) => part.path !== manifestPath && part.mediaType === expectedMime,
  );
  const file = manifest.files.find((entry: any) => entry.path === output.path);
  if (
    file?.sha256 !== output.checksum ||
    file?.byteLength !== output.size ||
    file?.mediaType !== output.mediaType
  )
    throw Error("Asset manifest checksum mismatch.");
  const acquired = await api.download(output, job);
  const bytes = options.recorded ? acquired.canonical : acquired.bytes;
  if (
    expectedMime === "image/svg+xml" &&
    !/^<svg\b[\s\S]*<\/svg>\s*$/.test(acquired.canonical.toString("utf8"))
  )
    throw Error("Invalid SVG.");
  const path =
    name + "." + (adapter.format === "animated-svg" ? "svg" : adapter.format);
  return {
    name,
    record: options.recorded ?? {
      ...record,
      delivery: acquired.delivery,
      files: { [path]: acquired.delivery.deliveredSha256 },
    },
    files: new Map([[path, bytes]]),
  };
}

async function kit(
  api: Service,
  kitId: string,
  name: string,
  requestedVersion?: number,
  recorded?: any,
): Promise<Install> {
  if (!localName.test(name)) throw Error("Choose a valid Kit directory name.");
  const snapshot = await api.post({ operation: "developer-kit", kitId });
  if (
    !Number.isSafeInteger(snapshot.version) ||
    (requestedVersion !== undefined && snapshot.version !== requestedVersion)
  )
    throw Error("Kit version mismatch.");
  const job = await api.job(
    {
      operation: "kit",
      kitId,
      kitVersion: snapshot.version,
      workspaceId: snapshot.workspaceId,
      options: { outputs: ["png"] },
    },
    recorded?.release?.releaseId,
  );
  const part = filePart(
    job,
    (file) => file.path === "kit.zip" && file.mediaType === "application/zip",
  );
  const acquired = await api.download(part, job);
  const contents = unpackKit(acquired.bytes);
  const manifest = JSON.parse(
    Buffer.from(contents[manifestPath] ?? []).toString("utf8"),
  );
  if (
    manifest.release?.releaseId !== job.releaseId ||
    manifest.snapshot?.version !== snapshot.version ||
    !Array.isArray(manifest.items)
  )
    throw Error("Kit snapshot mismatch.");
  for (const file of manifest.files)
    if (
      !Object.hasOwn(contents, file.path) ||
      contents[file.path].byteLength !== file.size ||
      checksum(contents[file.path]) !== file.sha256
    )
      throw Error("Kit manifest checksum mismatch.");
  const files = new Map(
    Object.entries(contents).map(([path, bytes]) => [name + "/" + path, bytes]),
  );
  return {
    name,
    files,
    record: {
      kind: "kit",
      kitId,
      kitVersion: snapshot.version,
      release: manifest.release,
      ...(snapshot.workspaceId ? { workspaceId: snapshot.workspaceId } : {}),
      items: manifest.items,
      delivery: acquired.delivery,
      files: Object.fromEntries(
        [...files].map(([path, bytes]) => [path, checksum(bytes)]),
      ),
    },
  };
}

function unpackKit(bytes: Uint8Array) {
  let expanded = 0;
  return unzipSync(bytes, {
    filter: (file) => {
      expanded += file.originalSize;
      if (!localPath(file.name) || expanded > sizeLimit)
        throw Error("Unsafe Kit archive.");
      return true;
    },
  });
}
async function replay(
  api: Service,
  name: string,
  saved: any,
): Promise<Install> {
  const { part, deliveredSha256 } = saved.delivery;
  const { bytes, delivery } = await api.download(part, saved.delivery);
  if (deliveredSha256 !== delivery.deliveredSha256)
    throw Error("Recorded delivery checksum changed.");
  const files: Map<string, Uint8Array> =
    saved.kind === "kit"
      ? new Map(
          Object.entries(unpackKit(bytes)).map(([path, data]) => [
            name + "/" + path,
            data,
          ]),
        )
      : new Map([[Object.keys(saved.files)[0], bytes]]);
  if (
    !same(
      Object.fromEntries(
        [...files].map(([path, data]) => [path, checksum(data)]),
      ),
      saved.files,
    )
  )
    throw Error("Recorded file checksum changed.");
  return { name, record: saved, files };
}

export async function runDelivery(
  command: string,
  operands: string[],
  flag: (key: string) => string | undefined,
  json: boolean,
) {
  const api = await service();
  const workspace = flag("workspace");
  const motion =
    flag("effect") || flag("pair") || flag("recording")
      ? {
          ...(flag("effect") ? { effect: flag("effect") } : {}),
          ...(flag("pair") ? { pairId: flag("pair") } : {}),
          ...(flag("recording")
            ? { recording: JSON.parse(flag("recording")!) }
            : {}),
        }
      : undefined;
  if (command === "search") {
    const result = await api.post({
      operation: "developer-search",
      query: operands.join(" "),
      family: flag("family"),
    });
    for (const row of result.results)
      row.preview = new URL(row.preview, api.origin).href;
    console.log(
      json
        ? JSON.stringify(result, null, 2)
        : result.results.length
          ? result.results
              .map(
                (r: any) =>
                  `${r.name} · ${r.family}${r.variant && r.variant !== r.name ? " · " + r.variant : ""}\n  ${r.key} · ${r.selection.expressionId} · ${r.preview}`,
              )
              .join("\n")
          : "No matching drawings.",
    );
    return;
  }
  if (command === "inspect") {
    if (operands.length !== 1) throw Error("Specify one drawing key.");
    const result = await inspect(api, address(operands[0]), motion, workspace);
    console.log(
      json
        ? JSON.stringify(result, null, 2)
        : [
            `${result.name}${result.drawingName !== result.name ? " · " + result.drawingName : ""} · ${result.selection.styleId} · ${result.selection.treatmentId}`,
            `${result.key}:${result.selection.masterId} (${result.masterVersion}) · ${result.preview}`,
            `Catalogue ${result.release.version} · Source ${result.assetVersion.id}@${result.assetVersion.revision}`,
            "Still outputs: " +
              result.outputs.map((item: any) => item.format).join(", "),
            ...result.alternatives.map(
              (item: any) =>
                `  ${item.name} · ${item.family} · ${item.treatment} · ${item.key}:${item.selection.masterId}`,
            ),
            ...(result.motion
              ? [
                  "Motion: " +
                    result.motion.effects
                      .map((effect: any) => effect.id)
                      .join(", "),
                  ...result.motion.transformations.map(
                    (pair: any) =>
                      `  ${pair.mode} · ${pair.id} → ${pair.to.expressionId}`,
                  ),
                ]
              : []),
            ...(result.selectedMotion
              ? [
                  `Selected Motion outputs: ${result.selectedMotion.outputs.map((o: any) => o.format).join(", ")}`,
                ]
              : []),
          ].join("\n"),
    );
    return;
  }
  if (command === "motion" && (!motion || operands.length !== 1))
    throw Error(
      "Choose one drawing and an effect, recording or Transform pair.",
    );
  if (
    flag("trigger") &&
    !["programmatic", "hover", "press", "toggle", "state-change"].includes(
      flag("trigger")!,
    )
  )
    throw Error("Unknown playback trigger.");
  if (command === "kit" && operands.length !== 1)
    throw Error("Specify one Kit ID.");
  if (command === "add" && !operands.length)
    throw Error("Specify one or more drawing keys.");
  await project(
    process.cwd(),
    async (entries) => {
      if (command === "reinstall") {
        const names = operands.length ? operands : Object.keys(entries);
        if (!names.length) throw Error("No recorded installations.");
        const installs = [];
        for (const name of names) {
          const saved = entries[name];
          if (!saved) throw Error("Unknown installed name: " + name);
          installs.push(
            saved.delivery
              ? await replay(api, name, saved)
              : saved.kind === "kit"
                ? await kit(api, saved.kitId, name, saved.kitVersion, saved)
                : await asset(
                    api,
                    {
                      key: saved.key,
                      masterId: saved.selection.masterId,
                      name,
                    },
                    saved.workspaceId,
                    {
                      format: saved.adapter.format,
                      motion: saved.motionRequest,
                      trigger: saved.trigger,
                      recorded: saved,
                    },
                  ),
          );
        }
        return installs;
      }
      if (command === "kit")
        return [
          await kit(
            api,
            operands[0],
            flag("as") ?? "kit",
            flag("version") === undefined ? undefined : Number(flag("version")),
          ),
        ];
      const sources = operands.map(address);
      if (flag("as") && sources.length === 1) sources[0].name = flag("as");
      const names = sources.map((s) => (s.name ?? s.key).toLowerCase());
      if (
        new Set(names).size !== names.length ||
        names.some((name) =>
          Object.keys(entries).some((key) => key.toLowerCase() === name),
        )
      )
        throw Error(
          "Local name collision. Choose a distinct name for each install.",
        );
      const installs = [];
      for (const source of sources)
        installs.push(
          await asset(api, source, workspace, {
            format: flag("format"),
            ...(command === "motion"
              ? { motion, trigger: flag("trigger") }
              : {}),
          }),
        );
      return installs;
    },
    command === "reinstall",
  );
  console.log(
    command === "reinstall"
      ? "Verified recorded IconsLibrary files."
      : "Installed into iconslibrary/.",
  );
}
