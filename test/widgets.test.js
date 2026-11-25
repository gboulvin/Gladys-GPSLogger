import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { HOME, createAllDevices, gpsParams, startApp } from './helpers.js';

const EXT = 'ext:test-integration:tracker:alice-phone';

async function content(gladys, key, request = {}) {
  const ack = await gladys.fake.widgetGet(key, {
    settings: {},
    language: 'fr',
    units: 'metric',
    ...request,
  });
  assert.equal(ack.success, true, ack.error);
  return ack.data.content ?? ack.data;
}

test('both widgets render an empty state without any tracker', async () => {
  const { gladys } = await startApp();
  for (const key of ['trackers_overview', 'tracker_status']) {
    const c = await content(gladys, key, { settings: { device: EXT } });
    assert.deepEqual(validateWidgetContent(c), []);
    assert.equal(c.components[0].type, 'text');
  }
});

test('trackers_overview lists the trackers, most recent first', async () => {
  const clock = { now: new Date('2026-06-01T12:00:00Z') };
  const { gladys, app } = await startApp({ clock });
  await app.engine.ingest(gpsParams({ device: 'Bob', batt: 10 }), { channel: 'local' });
  clock.now = new Date('2026-06-01T12:05:00Z');
  await app.engine.ingest(gpsParams({ lat: HOME.latitude, lon: HOME.longitude, batt: 90 }), {
    channel: 'cloud',
  });
  const c = await content(gladys, 'trackers_overview', { units: 'us' });
  assert.deepEqual(validateWidgetContent(c), []);
  const list = c.components.find((x) => x.type === 'card-list');
  assert.deepEqual(
    list.items.map((i) => i.title),
    ['Alice Phone', 'Bob'],
  );
  assert.equal(list.items[0].subtitle.en, 'Home');
  assert.match(list.items[1].subtitle.en, /^Away · [\d.]+ mi$/);
  assert.equal(list.items[1].badge.color, 'danger');
  const status = c.components.find((x) => x.type === 'status');
  assert.equal(status.items[0].value, '1 / 2');
});

test('tracker_status binds live tiles once the device exists', async () => {
  const { gladys, app } = await startApp();
  await app.engine.ingest(gpsParams({ batt: 55, spd: 3, acc: 12 }), { channel: 'local' });

  const before = await content(gladys, 'tracker_status', { settings: { device: EXT } });
  assert.deepEqual(validateWidgetContent(before), []);
  const inline = before.components.filter((x) => x.type === 'value');
  assert.ok(inline.every((tile) => tile.device_feature === undefined));
  assert.ok(inline.some((tile) => tile.value === 55));

  await createAllDevices(gladys);
  const after = await content(gladys, 'tracker_status', { settings: { device: EXT } });
  assert.deepEqual(validateWidgetContent(after), []);
  const tiles = after.components.filter((x) => x.type === 'value');
  const features = new Set(gladys.devices.flatMap((d) => d.features.map((f) => f.external_id)));
  assert.equal(tiles.length, 3);
  for (const tile of tiles) {
    assert.ok(features.has(tile.device_feature), tile.device_feature);
  }
  const button = after.components.find((x) => x.type === 'button');
  assert.match(button.link.url, /^https:\/\//);
});

test('every position nudges the widgets', async () => {
  const { gladys, app } = await startApp();
  const before = gladys.fake.widgetRefreshes.length;
  await app.engine.ingest(gpsParams(), { channel: 'local' });
  assert.ok(gladys.fake.widgetRefreshes.length > before);
});
