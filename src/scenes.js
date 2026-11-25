// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`, Gladys 5.1+).
//
// Each handler receives the RESOLVED fields (a `"source": "devices"` field is
// the chosen device external_id) and returns the declared scalar outputs. An
// unknown position is an output (`found: false`), not a failure: a scene
// action is never a condition, the scene author gates on `found`.
//
// Scene TRIGGERS are fired by the engine (src/engine.js) on every position.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { minutesSince } from './engine.js';
import { distanceMeters, mapsUrl, round } from './geo.js';

const logger = createLogger({ name: 'scenes' });

function positionOutputs(engine, tracker) {
  const { point } = tracker;
  return {
    found: true,
    device_name: tracker.name,
    latitude: round(point.latitude, 6),
    longitude: round(point.longitude, 6),
    accuracy: point.accuracy,
    altitude: point.altitude,
    speed: point.speed,
    battery: point.battery,
    distance_from_home:
      typeof tracker.distance_home === 'number'
        ? round(tracker.distance_home / 1000, 3)
        : undefined,
    at_home: typeof tracker.at_home === 'boolean' ? tracker.at_home : undefined,
    minutes_since_update: Math.round(minutesSince(tracker, engine.now())),
    maps_url: mapsUrl(point.latitude, point.longitude),
  };
}

const withoutUndefined = (object) =>
  Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));

const located = (engine, externalId) => {
  const tracker = engine.findByExternalId(externalId);
  return tracker?.point ? tracker : undefined;
};

export const SCENE_ACTIONS = {
  async get_position(engine, { fields }) {
    logger.info(`Scene action get_position <- ${fields.device}`);
    const tracker = located(engine, fields.device);
    if (!tracker) {
      return { found: false };
    }
    return withoutUndefined(positionOutputs(engine, tracker));
  },

  async distance_between_trackers(engine, { fields }) {
    logger.info(`Scene action distance_between_trackers <- ${fields.device_a}, ${fields.device_b}`);
    const a = located(engine, fields.device_a);
    const b = located(engine, fields.device_b);
    if (!a || !b) {
      return { found: false };
    }
    const meters = distanceMeters(a.point, b.point);
    return { found: true, distance_km: round(meters / 1000, 3), distance_m: Math.round(meters) };
  },

  async distance_to_point(engine, { fields }) {
    logger.info(`Scene action distance_to_point <- ${fields.device}`);
    const tracker = located(engine, fields.device);
    const latitude = Number(fields.latitude);
    const longitude = Number(fields.longitude);
    if (!tracker || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return { found: false };
    }
    const meters = distanceMeters(tracker.point, { latitude, longitude });
    const radius = Number.isFinite(Number(fields.radius)) ? Number(fields.radius) : 200;
    return {
      found: true,
      distance_km: round(meters / 1000, 3),
      distance_m: Math.round(meters),
      inside: meters <= radius,
    };
  },
};
