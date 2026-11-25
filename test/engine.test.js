import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AWAY, HOME, createAllDevices, gpsParams, startApp } from './helpers.js';
import { buildDevice } from '../src/trackers.js';

const EXT = 'ext:test-integration:tracker:alice-phone';

function events(gladys, key) {
  return gladys.fake.sceneEvents.filter((e) => e.key === key);
}

test('a new phone is published to the Discovery tab, with complete features', async () => {
  const { gladys, app } = await startApp();
  const result = await app.engine.ingest(gpsParams({ batt: 80 }), { channel: 'local' });
  assert.equal(result.status, 200);

  const [device] = gladys.fake.discoveredDevices;
  assert.equal(device.external_id, EXT);
  assert.equal(device.name, 'Alice Phone');
  for (const feature of device.features) {
    for (const column of ['name', 'min', 'max', 'read_only', 'has_feedback']) {
      assert.notEqual(feature[column], undefined, `${feature.external_id}.${column}`);
    }
    assert.ok(feature.min <= feature.max);
  }
  // Not created yet: no state.
  assert.equal(gladys.fake.states.length, 0);
});

test('the states follow once the device is created, then on every position', async () => {
  const { gladys, app } = await startApp();
  await app.engine.ingest(gpsParams({ batt: 80, spd: 2 }), { channel: 'local' });
  await createAllDevices(gladys);

  // Creating the device publishes the last known position.
  assert.equal(gladys.fake.lastState(`${EXT}:latitude`), AWAY.latitude);
  assert.equal(gladys.fake.lastState(`${EXT}:battery`), 80);
  assert.equal(gladys.fake.lastState(`${EXT}:speed`), 7.2);
  assert.equal(gladys.fake.lastState(`${EXT}:at-home`), 0);
  assert.ok(gladys.fake.lastState(`${EXT}:distance-home`) > 3);

  await app.engine.ingest(gpsParams({ lat: HOME.latitude, lon: HOME.longitude, batt: 79 }), {
    channel: 'cloud',
  });
  assert.equal(gladys.fake.lastState(`${EXT}:at-home`), 1);
  assert.equal(gladys.fake.lastState(`${EXT}:battery`), 79);
  assert.deepEqual(gladys.fake.transports.at(-1), { device_external_id: EXT, transport: 'cloud' });
});

test('arrived_home and left_home fire on transitions only, with hysteresis', async () => {
  const { gladys, app } = await startApp({ config: { home_radius: 100 } });
  const at = (lat, lon) => app.engine.ingest(gpsParams({ lat, lon }), { channel: 'local' });

  await at(AWAY.latitude, AWAY.longitude); // first position: no transition
  assert.equal(events(gladys, 'arrived_home').length, 0);
  assert.equal(events(gladys, 'left_home').length, 0);

  await at(HOME.latitude, HOME.longitude);
  assert.equal(events(gladys, 'arrived_home').length, 1);
  assert.deepEqual(events(gladys, 'arrived_home')[0].data, {
    device: EXT,
    device_name: 'Alice Phone',
    latitude: HOME.latitude,
    longitude: HOME.longitude,
  });

  // ~111 m north: beyond the radius, within the exit margin (125 m).
  await at(HOME.latitude + 0.001, HOME.longitude);
  assert.equal(events(gladys, 'left_home').length, 0);

  await at(AWAY.latitude, AWAY.longitude);
  const [left] = events(gladys, 'left_home');
  assert.ok(left.data.distance_from_home > 3);
  assert.equal(events(gladys, 'position_updated').length, 4);
});

test('an imprecise position does not change the home state', async () => {
  const { gladys, app } = await startApp();
  await app.engine.ingest(gpsParams({ lat: HOME.latitude, lon: HOME.longitude }), {
    channel: 'local',
  });
  await app.engine.ingest(gpsParams({ acc: 5000 }), { channel: 'local' });
  assert.equal(events(gladys, 'left_home').length, 0);
  assert.equal(app.store.get('alice-phone').at_home, true);
});

test('battery_low fires once below the threshold, and again after a recharge', async () => {
  const { gladys, app } = await startApp({ config: { battery_low_threshold: 20 } });
  for (const batt of [25, 19, 15, 22, 30, 18]) {
    await app.engine.ingest(gpsParams({ batt }), { channel: 'local' });
  }
  const fired = events(gladys, 'battery_low').map((e) => e.data.battery);
  assert.deepEqual(fired, [19, 18]);
});

test('without a located house, no home feature nor home event', async () => {
  const { gladys, app } = await startApp({ houses: [] });
  await app.engine.ingest(gpsParams(), { channel: 'local' });
  await createAllDevices(gladys);
  assert.equal(gladys.fake.lastState(`${EXT}:at-home`), undefined);
  assert.equal(events(gladys, 'position_updated')[0].data.distance_from_home, undefined);
});

test('the token is required when configured, as a parameter or a Bearer header', async () => {
  const { gladys, app } = await startApp({ config: { token: 's3cret' } });
  assert.equal((await app.engine.ingest(gpsParams(), { channel: 'local' })).status, 401);
  assert.equal(
    (await app.engine.ingest(gpsParams({ token: 'wrong' }), { channel: 'local' })).status,
    401,
  );
  assert.equal(gladys.fake.discoveredDevices.length, 0);
  assert.equal(
    (await app.engine.ingest(gpsParams({ token: 's3cret' }), { channel: 'local' })).status,
    200,
  );
  assert.equal(
    (await app.engine.ingest(gpsParams(), { channel: 'local', authorization: 'Bearer s3cret' }))
      .status,
    200,
  );
});

test('an older position replayed by GPSLogger does not move the tracker back', async () => {
  const { app } = await startApp();
  await app.engine.ingest(gpsParams({ time: '2026-06-01T12:00:00Z' }), { channel: 'local' });
  await app.engine.ingest(
    gpsParams({ lat: HOME.latitude, lon: HOME.longitude, time: '2026-06-01T11:00:00Z' }),
    { channel: 'local' },
  );
  assert.equal(app.store.get('alice-phone').point.latitude, AWAY.latitude);
});

test('the Gladys Plus webhook answers GPSLogger, 401 on a wrong token', async () => {
  const { gladys } = await startApp({ config: { token: 'abc' } });
  const ok = await gladys.fake.webhook(
    'gpslogger',
    {
      method: 'POST',
      query: { token: 'abc' },
      body: 'device=bob&lat=45.1&lon=5.7',
      contentType: 'application/x-www-form-urlencoded',
    },
    { mode: 'sync' },
  );
  assert.equal(ok.success, true);
  assert.equal(ok.data.status, 200);
  assert.equal(gladys.fake.discoveredDevices[0].name, 'bob');

  const refused = await gladys.fake.webhook(
    'gpslogger',
    { method: 'GET', query: { device: 'bob', lat: '1', lon: '1' } },
    { mode: 'sync' },
  );
  assert.equal(refused.data.status, 401);
});

test('a tracker silent for too long is lost once, and found again', async () => {
  const clock = { now: new Date('2026-06-01T12:00:00Z') };
  const { gladys, app } = await startApp({ clock, config: { stale_minutes: 30 } });
  await app.engine.ingest(gpsParams(), { channel: 'local' });
  await createAllDevices(gladys);

  clock.now = new Date('2026-06-01T12:20:00Z');
  assert.equal((await app.engine.checkLost()).length, 0);

  clock.now = new Date('2026-06-01T12:45:00Z');
  assert.equal((await app.engine.checkLost()).length, 1);
  assert.equal((await app.engine.checkLost()).length, 0);
  assert.deepEqual(events(gladys, 'tracker_lost')[0].data, {
    device: EXT,
    device_name: 'Alice Phone',
    minutes_since_update: 45,
  });
  assert.equal(gladys.fake.transports.at(-1).transport, 'unreachable');

  await app.engine.ingest(gpsParams(), { channel: 'local' });
  assert.equal(app.store.get('alice-phone').lost, false);
  assert.equal(gladys.fake.transports.at(-1).transport, 'local');
});

test('forget_tracker removes the tracker from the Discovery list', async () => {
  const { gladys, app } = await startApp();
  await app.engine.ingest(gpsParams(), { channel: 'local' });
  await app.engine.ingest(gpsParams({ device: 'Bob' }), { channel: 'local' });
  assert.equal(gladys.fake.discoveredDevices.length, 2);
  const ack = await gladys.fake.action('forget_tracker', { device: EXT });
  assert.equal(ack.success, true);
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => d.name),
    ['Bob'],
  );
});

test('the device structure never depends on what the phone sends', () => {
  const gladys = {
    externalIds: (type, id) => ({
      device: `x:${type}:${id}`,
      feature: (k) => `x:${type}:${id}:${k}`,
    }),
  };
  const a = buildDevice(gladys, { id: 'a', name: 'A', point: { latitude: 1, longitude: 1 } });
  const b = buildDevice(gladys, { id: 'a', name: 'A' });
  assert.deepEqual(a, b);
});
