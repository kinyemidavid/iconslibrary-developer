import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const bin = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

test('bundled CLI exposes the consumer commands without private modules', async () => {
  const { stdout } = await exec(process.execPath, [bin, '--help']);
  for (const command of ['login', 'search', 'inspect', 'add', 'kit', 'motion', 'reinstall'])
    assert.match(stdout, new RegExp(`iconslibrary ${command}\\b`));
  assert.doesNotMatch(stdout, /Convex|checkout|\.tgz/);
});

test('browser approval URL must belong to the issuing site', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'iconslibrary-test-'));
  const server = createServer((request, response) => {
    assert.equal(request.url, '/api/product');
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ verificationUri: 'https://example.invalid/account/developer-access/authorize' }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const site = 'http://127.0.0.1:' + server.address().port;
    await assert.rejects(exec(process.execPath, [bin, 'login', '--site=' + site, '--no-open'], { cwd: dir }), /Invalid developer approval request/);
    assert.deepEqual(await readdir(dir), []);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
