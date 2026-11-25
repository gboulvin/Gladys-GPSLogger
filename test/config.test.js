import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig } from '../src/config.js';

test('normalizeConfig applies the defaults', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
});

test('normalizeConfig types and bounds the values', () => {
  const config = normalizeConfig({
    home_radius: '5',
    battery_low_threshold: '30',
    stale_minutes: 'abc',
    local_receiver: false,
    token: '  t  ',
  });
  assert.equal(config.home_radius, 20);
  assert.equal(config.battery_low_threshold, 30);
  assert.equal(config.stale_minutes, DEFAULT_CONFIG.stale_minutes);
  assert.equal(config.local_receiver, false);
  assert.equal(config.token, 't');
});
