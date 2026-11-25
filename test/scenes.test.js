import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AWAY, HOME, gpsParams, startApp } from './helpers.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const EXT = (id) => `ext:test-integration:tracker:${id}`;

function declaredOutputs(key) {
  return manifest.scene_actions.find((a) => a.key === key).outputs.map((o) => o.key);
}

test('get_position returns the declared outputs of a known tracker', async () => {
  const { gladys, app } = await startApp();
  await app.engine.ingest(gpsParams({ batt: 64, acc: 8 }), { channel: 'local' });
  const ack = await gladys.fake.sceneAction('get_position', { device: EXT('alice-phone') });
  assert.equal(ack.success, true);
  const outputs = ack.data.outputs ?? ack.data;
  assert.equal(outputs.found, true);
  assert.equal(outputs.battery, 64);
  assert.equal(outputs.at_home, false);
  assert.match(outputs.maps_url, /^https:\/\/www\.openstreetmap\.org\//);
  for (const key of Object.keys(outputs)) {
    assert.ok(declaredOutputs('get_position').includes(key), `output ${key} is not declared`);
    assert.notEqual(typeof outputs[key], 'object');
  }
});

test('get_position of an unknown tracker is found: false, not a failure', async () => {
  const { gladys } = await startApp();
  const ack = await gladys.fake.sceneAction('get_position', { device: EXT('nobody') });
  assert.equal(ack.success, true);
  assert.equal((ack.data.outputs ?? ack.data).found, false);
});

test('distance_between_trackers and distance_to_point', async () => {
  const { gladys, app } = await startApp();
  await app.engine.ingest(gpsParams({ device: 'a' }), { channel: 'local' });
  await app.engine.ingest(gpsParams({ device: 'b', lat: HOME.latitude, lon: HOME.longitude }), {
    channel: 'local',
  });
  const between = await gladys.fake.sceneAction('distance_between_trackers', {
    device_a: EXT('a'),
    device_b: EXT('b'),
  });
  const b = between.data.outputs ?? between.data;
  assert.equal(b.found, true);
  assert.ok(b.distance_km > 4 && b.distance_km < 5, `${b.distance_km}`);
  assert.equal(b.distance_m, Math.round(b.distance_km * 1000));

  const point = await gladys.fake.sceneAction('distance_to_point', {
    device: EXT('a'),
    latitude: AWAY.latitude,
    longitude: AWAY.longitude + 0.001,
    radius: 200,
  });
  const p = point.data.outputs ?? point.data;
  assert.equal(p.inside, true);
  assert.ok(p.distance_m > 50 && p.distance_m < 100);
});
