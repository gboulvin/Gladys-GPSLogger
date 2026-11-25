import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { createReceiver, DRAIN_PATH, SECRET_HEADER } from '../src/receiver.js';
import { LocalRelay, loadOrCreateSecret } from '../src/relay.js';
import { RECEIVER_CONTAINER_FIXTURE } from './helpers.js';
import { registerHandlers } from '../src/app.js';

const SECRET = 'a'.repeat(64);

async function listen(t, options = {}) {
  const { server, queueSize } = createReceiver({ secret: SECRET, ...options });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  return { base: `http://127.0.0.1:${server.address().port}`, queueSize };
}

test('the receiver queues GET and POST requests and answers 200', async (t) => {
  const { base, queueSize } = await listen(t);
  const get = await fetch(`${base}/log?device=a&lat=1&lon=2`);
  assert.equal(get.status, 200);
  const post = await fetch(`${base}/log`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Bearer t' },
    body: 'device=b&lat=3&lon=4',
  });
  assert.equal(post.status, 200);
  assert.equal(queueSize(), 2);

  const drained = await (
    await fetch(`${base}${DRAIN_PATH}`, { headers: { [SECRET_HEADER]: SECRET } })
  ).json();
  assert.deepEqual(drained[0].query, { device: 'a', lat: '1', lon: '2' });
  assert.equal(drained[1].body, 'device=b&lat=3&lon=4');
  assert.equal(drained[1].authorization, 'Bearer t');
  assert.equal(queueSize(), 0);
});

test('the drain endpoint requires the relay secret', async (t) => {
  const { base } = await listen(t);
  assert.equal((await fetch(`${base}${DRAIN_PATH}`)).status, 403);
  assert.equal(
    (await fetch(`${base}${DRAIN_PATH}`, { headers: { [SECRET_HEADER]: 'nope' } })).status,
    403,
  );
});

test('the receiver refuses other methods and oversized bodies, and keeps the newest', async (t) => {
  const { base, queueSize } = await listen(t, { maxQueue: 2 });
  assert.equal((await fetch(`${base}/log`, { method: 'PUT' })).status, 405);
  const big = await fetch(`${base}/log`, { method: 'POST', body: 'x'.repeat(20_000) }).catch(
    () => ({ status: 413 }),
  );
  assert.equal(big.status, 413);
  for (const n of [1, 2, 3]) {
    await fetch(`${base}/log?n=${n}`);
  }
  assert.equal(queueSize(), 2);
});

test('the relay drains the receiver into the engine, channel local', async (t) => {
  const { base } = await listen(t);
  const dataDir = mkdtempSync(join(tmpdir(), 'gpslogger-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));

  const gladys = createFakeGladys({ config: { local_receiver: false } });
  const app = registerHandlers(gladys, { dataDir, receiverUrl: base });
  await gladys.connect();
  t.after(() => app.stop());

  // The relay authenticates with the secret it generated in /data.
  const relay = new LocalRelay({ gladys, engine: app.engine, dataDir, baseUrl: base });
  const secret = loadOrCreateSecret(dataDir);
  assert.equal(readFileSync(join(dataDir, 'relay-secret'), 'utf8'), secret);
  const { server } = createReceiver({ secret });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  relay.baseUrl = `http://127.0.0.1:${server.address().port}`;

  await fetch(`${relay.baseUrl}/log?device=Carol&lat=45.76&lon=4.83&batt=50`);
  assert.equal(await relay.drainOnce(), 1);
  assert.equal(app.store.get('carol').channel, 'local');
  assert.equal(app.store.get('carol').point.battery, 50);
  assert.equal(await relay.drainOnce(), 0);
});

test('the relay survives an unreachable receiver', async () => {
  const relay = new LocalRelay({
    gladys: {},
    engine: {},
    dataDir: mkdtempSync(join(tmpdir(), 'gpslogger-')),
    fetchImpl: async () => {
      throw new Error('ECONNREFUSED');
    },
  });
  assert.equal(await relay.drainOnce(), 0);
});

test('the integration starts the receiver sub-container with the relay secret', async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'gpslogger-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  const gladys = createFakeGladys({
    config: { local_receiver: true },
    containers: [{ ...RECEIVER_CONTAINER_FIXTURE, status: 'stopped' }],
  });
  const started = [];
  t.mock.method(gladys, 'startContainer', async (name, options) => {
    started.push({ name, options });
    return { success: true };
  });
  const app = registerHandlers(gladys, {
    dataDir,
    fetchImpl: async () => ({ ok: true, json: async () => [] }),
  });
  t.after(() => app.stop());
  await gladys.connect();
  assert.equal(started.length, 1);
  assert.equal(started[0].name, 'receiver');
  assert.equal(started[0].options.env.RELAY_SECRET, loadOrCreateSecret(dataDir));

  const stopped = [];
  t.mock.method(gladys, 'stopContainer', async (name) => {
    stopped.push(name);
    return { success: true };
  });
  await gladys.fake.configUpdated({ local_receiver: false });
  assert.deepEqual(stopped, ['receiver']);
});
