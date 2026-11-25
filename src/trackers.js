// -----------------------------------------------------------------------------
// The Gladys device of a tracker (one phone running GPSLogger).
//
// GPSLogger only reports: every feature is a read-only sensor. The structure
// is the same for every phone, whatever it actually sends (a phone without
// battery reporting simply never fills the battery feature), so the device
// never changes shape and never asks the user to "Update" it.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CATEGORIES,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as UNITS,
} from '@gladysassistant/integration-sdk';
import { formatCoordinates, round } from './geo.js';

// Device type, part of every external_id: never rename it.
export const TRACKER_TYPE = 'tracker';

// Feature keys, part of the feature external_ids: never rename them.
export const FEATURE = {
  LATITUDE: 'latitude',
  LONGITUDE: 'longitude',
  POSITION: 'position',
  ACCURACY: 'accuracy',
  ALTITUDE: 'altitude',
  SPEED: 'speed',
  DIRECTION: 'direction',
  BATTERY: 'battery',
  CHARGING: 'charging',
  DISTANCE_HOME: 'distance-home',
  AT_HOME: 'at-home',
};

const sensor = (name, key, category, type, unit, min, max) => ({
  name,
  key,
  category,
  type,
  unit,
  min,
  max,
});

// `name`, `min`, `max`, `read_only` and `has_feedback` are mandatory on every
// feature (Gladys stores them NOT NULL): min/max are the real range of a
// numeric sensor, 0/1 for a binary one, 0/0 for a text.
const FEATURES = [
  sensor('Position', FEATURE.POSITION, CATEGORIES.TEXT, TYPES.TEXT.TEXT, null, 0, 0),
  sensor('Latitude', FEATURE.LATITUDE, CATEGORIES.ANGLE_SENSOR, 'decimal', UNITS.DEGREE, -90, 90),
  sensor(
    'Longitude',
    FEATURE.LONGITUDE,
    CATEGORIES.ANGLE_SENSOR,
    'decimal',
    UNITS.DEGREE,
    -180,
    180,
  ),
  sensor('At home', FEATURE.AT_HOME, CATEGORIES.PRESENCE_SENSOR, 'binary', null, 0, 1),
  sensor(
    'Distance from home',
    FEATURE.DISTANCE_HOME,
    CATEGORIES.DISTANCE_SENSOR,
    'decimal',
    UNITS.KM,
    0,
    20040,
  ),
  sensor('Accuracy', FEATURE.ACCURACY, CATEGORIES.DISTANCE_SENSOR, 'decimal', UNITS.M, 0, 100000),
  sensor('Altitude', FEATURE.ALTITUDE, CATEGORIES.DISTANCE_SENSOR, 'decimal', UNITS.M, -500, 10000),
  sensor(
    'Speed',
    FEATURE.SPEED,
    CATEGORIES.SPEED_SENSOR,
    TYPES.SPEED_SENSOR.DECIMAL,
    UNITS.KILOMETER_PER_HOUR,
    0,
    1300,
  ),
  sensor('Direction', FEATURE.DIRECTION, CATEGORIES.ANGLE_SENSOR, 'decimal', UNITS.DEGREE, 0, 360),
  sensor(
    'Battery',
    FEATURE.BATTERY,
    CATEGORIES.BATTERY,
    TYPES.BATTERY.INTEGER,
    UNITS.PERCENT,
    0,
    100,
  ),
  sensor('Charging', FEATURE.CHARGING, CATEGORIES.BATTERY, TYPES.BATTERY.CHARGING, null, 0, 1),
];

export function trackerIds(gladys, trackerId) {
  return gladys.externalIds(TRACKER_TYPE, trackerId);
}

/** The tracker id of a device external_id, or undefined for another device. */
export function trackerIdFromExternalId(gladys, externalId) {
  const prefix = gladys.externalId(`${TRACKER_TYPE}:`);
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return undefined;
  }
  const rest = externalId.slice(prefix.length);
  return rest && !rest.includes(':') ? rest : undefined;
}

/** Discovery payload of one tracker. */
export function buildDevice(gladys, tracker) {
  const ids = trackerIds(gladys, tracker.id);
  return {
    name: tracker.name,
    external_id: ids.device,
    model: 'GPSLogger',
    features: FEATURES.map(({ key, unit, ...feature }) => ({
      ...feature,
      external_id: ids.feature(key),
      ...(unit ? { unit } : {}),
      read_only: true,
      has_feedback: false,
      // The text position has no history (Gladys keeps none for texts).
      keep_history: key !== FEATURE.POSITION,
    })),
  };
}

/** Feature external_id of one feature of a tracker. */
export function featureExternalId(gladys, trackerId, key) {
  return trackerIds(gladys, trackerId).feature(key);
}

/**
 * States of a tracker, in the `publishStates` format: only the values the
 * phone actually reported, plus the home ones when a house location is known.
 */
export function buildStates(gladys, tracker) {
  const { point } = tracker;
  if (!point) {
    return [];
  }
  const ids = trackerIds(gladys, tracker.id);
  const states = [
    { device_feature_external_id: ids.feature(FEATURE.LATITUDE), state: round(point.latitude, 6) },
    {
      device_feature_external_id: ids.feature(FEATURE.LONGITUDE),
      state: round(point.longitude, 6),
    },
    {
      device_feature_external_id: ids.feature(FEATURE.POSITION),
      text: formatCoordinates(point.latitude, point.longitude),
    },
  ];
  const numeric = [
    [FEATURE.ACCURACY, point.accuracy, 1],
    [FEATURE.ALTITUDE, point.altitude, 1],
    [FEATURE.SPEED, point.speed, 1],
    [FEATURE.DIRECTION, point.direction, 0],
    [FEATURE.BATTERY, point.battery, 0],
  ];
  for (const [key, value, digits] of numeric) {
    if (value !== undefined) {
      states.push({ device_feature_external_id: ids.feature(key), state: round(value, digits) });
    }
  }
  if (point.charging !== undefined) {
    states.push({
      device_feature_external_id: ids.feature(FEATURE.CHARGING),
      state: point.charging ? 1 : 0,
    });
  }
  if (typeof tracker.distance_home === 'number') {
    states.push({
      device_feature_external_id: ids.feature(FEATURE.DISTANCE_HOME),
      state: round(tracker.distance_home / 1000, 3),
    });
  }
  if (typeof tracker.at_home === 'boolean') {
    states.push({
      device_feature_external_id: ids.feature(FEATURE.AT_HOME),
      state: tracker.at_home ? 1 : 0,
    });
  }
  return states;
}
