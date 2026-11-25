import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractToken, parsePoint, parseRequest, trackerIdFromName } from '../src/payload.js';

const NOW = new Date('2026-06-01T12:00:00Z');

test('parseRequest merges the query and a form-encoded body', () => {
  const params = parseRequest({
    query: { Device: 'phone' },
    body: 'lat=48.1&lon=2.2&batt=55',
    contentType: 'application/x-www-form-urlencoded',
  });
  assert.deepEqual(params, { device: 'phone', lat: '48.1', lon: '2.2', batt: '55' });
});

test('parseRequest reads a JSON body, as a string or already parsed', () => {
  assert.equal(
    parseRequest({ body: '{"latitude": 1.5}', contentType: 'application/json' }).latitude,
    '1.5',
  );
  assert.equal(parseRequest({ body: { longitude: 3 } }).longitude, '3');
});

test('parsePoint accepts the GPSLogger short names and converts the speed to km/h', () => {
  const { ok, point } = parsePoint(
    {
      device: 'Alice Phone',
      lat: '48.8584',
      lon: '2.2945',
      acc: '12.5',
      alt: '35',
      spd: '10',
      dir: '90',
      batt: '76.0',
      ischarging: 'false',
      prov: 'gps',
      time: '2026-06-01T11:59:00Z',
    },
    NOW,
  );
  assert.equal(ok, true);
  assert.deepEqual(point, {
    name: 'Alice Phone',
    id: 'alice-phone',
    latitude: 48.8584,
    longitude: 2.2945,
    accuracy: 12.5,
    altitude: 35,
    speed: 36,
    direction: 90,
    battery: 76,
    charging: false,
    provider: 'gps',
    timestamp: '2026-06-01T11:59:00.000Z',
  });
});

test('parsePoint accepts the Home Assistant long names', () => {
  const { point } = parsePoint(
    { device: 'bob', latitude: '-33.9', longitude: '151.2', battery: '20', accuracy: '5' },
    NOW,
  );
  assert.equal(point.latitude, -33.9);
  assert.equal(point.battery, 20);
  assert.equal(point.timestamp, NOW.toISOString());
});

test('parsePoint ignores unresolved placeholders and out-of-range values', () => {
  const { point } = parsePoint({ device: 'p', lat: '1', lon: '1', batt: '%BATT', spd: '-1' }, NOW);
  assert.equal(point.battery, undefined);
  assert.equal(point.speed, undefined);
});

test('parsePoint refuses a request without device or valid coordinates', () => {
  assert.equal(parsePoint({ lat: '1', lon: '1' }, NOW).ok, false);
  assert.equal(parsePoint({ device: 'p', lat: '91', lon: '1' }, NOW).ok, false);
  assert.equal(parsePoint({ device: 'p', lat: 'abc', lon: '1' }, NOW).ok, false);
  assert.equal(parsePoint({ device: 'p', lat: '0', lon: '0' }, NOW).ok, false);
  assert.equal(parsePoint({ device: '!!!', lat: '1', lon: '1' }, NOW).ok, false);
});

test('parsePoint reads epoch timestamps and refuses dates in the future', () => {
  assert.equal(
    parsePoint({ device: 'p', lat: '1', lon: '1', timestamp: '1780315140' }, NOW).point.timestamp,
    '2026-06-01T11:59:00.000Z',
  );
  assert.equal(
    parsePoint({ device: 'p', lat: '1', lon: '1', timestamp: '2030-01-01T00:00:00Z' }, NOW).point
      .timestamp,
    NOW.toISOString(),
  );
});

test('trackerIdFromName is stable, ASCII and bounded', () => {
  assert.equal(trackerIdFromName('Téléphone de Zoé'), 'telephone-de-zoe');
  assert.equal(trackerIdFromName('  Pixel 8 Pro  '), 'pixel-8-pro');
  assert.equal(trackerIdFromName('a'.repeat(80)).length, 40);
});

test('extractToken reads the token parameter or a Bearer header', () => {
  assert.equal(extractToken({ token: 'abc' }), 'abc');
  assert.equal(extractToken({}, 'Bearer xyz'), 'xyz');
  assert.equal(extractToken({}, 'Basic xyz'), undefined);
});
