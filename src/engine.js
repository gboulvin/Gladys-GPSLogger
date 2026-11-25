// -----------------------------------------------------------------------------
// Tracker engine: what happens when a position arrives, whatever the channel
// (the local receiver or the Gladys Plus webhook).
//
//   1. check the access token, parse the position;
//   2. update the tracker: distance from home, home / battery / lost flags;
//   3. publish to Gladys: the discovery list (new phone), the states (device
//      created by the user), the transport badge, the scene events, a widget
//      refresh nudge.
//
// The engine also watches the trackers that stopped reporting ("lost").
// -----------------------------------------------------------------------------

import { timingSafeEqual } from 'node:crypto';
import { createLogger, DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { distanceMeters, mapsUrl, round } from './geo.js';
import { extractToken, parsePoint } from './payload.js';
import { buildDevice, buildStates, trackerIdFromExternalId, trackerIds } from './trackers.js';

const logger = createLogger({ name: 'engine' });

// Scene trigger keys, as declared in the manifest `scene_triggers` field.
// Keys are forever: scenes store them.
export const TRIGGERS = {
  POSITION_UPDATED: 'position_updated',
  ARRIVED_HOME: 'arrived_home',
  LEFT_HOME: 'left_home',
  BATTERY_LOW: 'battery_low',
  TRACKER_LOST: 'tracker_lost',
};

export const CHANNELS = { LOCAL: 'local', CLOUD: 'cloud' };

// Leaving home needs the tracker to be this much further than the radius:
// GPS jitter at the edge of the radius must not flap arrived/left/arrived.
const HOME_EXIT_FACTOR = 1.25;
// A position less precise than this does not change the home state.
const MAX_ACCURACY_FOR_HOME_M = 1000;
// The battery_low flag resets this many points above the threshold.
const BATTERY_HYSTERESIS = 5;
// Unchanged states are re-sent this often, so they stay recently dated.
const STATE_HEARTBEAT_MS = 30 * 60 * 1000;

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Minutes elapsed since a tracker's last position. */
export function minutesSince(tracker, now = new Date()) {
  if (!tracker?.updated_at) {
    return undefined;
  }
  return Math.max(0, (now.getTime() - new Date(tracker.updated_at).getTime()) / 60_000);
}

/** Flat scene event / action values, without the undefined ones. */
function compact(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

export class TrackerEngine {
  /**
   * @param {object} options
   * @param {import('@gladysassistant/integration-sdk').GladysIntegration} options.gladys
   * @param {import('./store.js').TrackerStore} options.store
   * @param {() => object} options.getConfig current normalized config
   * @param {() => ({ latitude: number, longitude: number } | null)} options.getHome
   * @param {() => Date} [options.now]
   */
  constructor({ gladys, store, getConfig, getHome, now = () => new Date() }) {
    this.gladys = gladys;
    this.store = store;
    this.getConfig = getConfig;
    this.getHome = getHome;
    this.now = now;
  }

  // --- Lookups ---------------------------------------------------------------

  findByExternalId(externalId) {
    const id = trackerIdFromExternalId(this.gladys, externalId);
    return id ? this.store.get(id) : undefined;
  }

  deviceExternalId(tracker) {
    return trackerIds(this.gladys, tracker.id).device;
  }

  isCreated(tracker) {
    const externalId = this.deviceExternalId(tracker);
    return (this.gladys.devices ?? []).some((device) => device.external_id === externalId);
  }

  isLost(tracker) {
    const minutes = minutesSince(tracker, this.now());
    return minutes === undefined || minutes >= this.getConfig().stale_minutes;
  }

  // --- Ingestion -------------------------------------------------------------

  /**
   * Handle one GPSLogger request.
   * @param {Record<string, string>} params merged query + body (parseRequest)
   * @param {object} context
   * @param {'local' | 'cloud'} context.channel where the request came from
   * @param {string} [context.authorization] Authorization header, if any
   * @param {boolean} [context.trusted] skip the token check (test action)
   * @param {string} [context.receivedAt] when the request reached the
   *   receiver: the position date when the phone sends none
   * @returns {Promise<{ status: number, message: string, tracker?: object }>}
   */
  async ingest(params, { channel, authorization, trusted = false, receivedAt }) {
    const config = this.getConfig();
    if (
      !trusted &&
      config.token &&
      !safeEqual(extractToken(params, authorization) ?? '', config.token)
    ) {
      logger.warn(`Position refused (${channel}): missing or wrong token`);
      return { status: 401, message: 'Unauthorized' };
    }
    const received = receivedAt ? new Date(receivedAt) : this.now();
    const parsed = parsePoint(params, Number.isNaN(received.getTime()) ? this.now() : received);
    if (!parsed.ok) {
      logger.warn(`Position refused (${channel}): ${parsed.reason}`);
      return { status: 400, message: parsed.reason };
    }
    const { point } = parsed;
    const previous = this.store.get(point.id);
    if (previous?.point && new Date(point.timestamp) < new Date(previous.point.timestamp)) {
      // GPSLogger replays its queue after a network outage: an older point
      // must not move the tracker back in time.
      logger.debug(`Older position of ${point.id} ignored`);
      return { status: 200, message: 'OK (older position ignored)' };
    }

    const { name, id, ...position } = point;
    const tracker = {
      ...(previous ?? {}),
      id,
      name: previous?.name ?? name,
      point: position,
      channel,
      updated_at: this.now().toISOString(),
      lost: false,
    };
    const events = this.updateFlags(tracker, previous, config);
    this.store.set(tracker);
    logger.info(
      `Position of ${tracker.name} (${channel}): ${position.latitude}, ${position.longitude}`,
    );

    await this.publish(tracker, { isNew: !previous, events });
    return { status: 200, message: 'OK', tracker };
  }

  /** Home distance, home / battery transitions. Returns the events to fire. */
  updateFlags(tracker, previous, config) {
    const events = [];
    const { point } = tracker;
    const home = this.getHome();
    const common = compact({
      device: this.deviceExternalId(tracker),
      device_name: tracker.name,
      latitude: round(point.latitude, 6),
      longitude: round(point.longitude, 6),
    });

    if (home) {
      const distance = distanceMeters(home, point);
      tracker.distance_home = Math.round(distance);
      const wasHome = previous?.at_home;
      const precise = point.accuracy === undefined || point.accuracy <= MAX_ACCURACY_FOR_HOME_M;
      let atHome = typeof wasHome === 'boolean' ? wasHome : undefined;
      if (precise || atHome === undefined) {
        atHome =
          wasHome === true
            ? distance <= config.home_radius * HOME_EXIT_FACTOR
            : distance <= config.home_radius;
      }
      tracker.at_home = atHome;
      // No event on the very first position: unknown -> known is not a move.
      if (wasHome === false && atHome === true) {
        events.push([TRIGGERS.ARRIVED_HOME, common]);
      } else if (wasHome === true && atHome === false) {
        events.push([
          TRIGGERS.LEFT_HOME,
          { ...common, distance_from_home: round(distance / 1000, 3) },
        ]);
      }
    } else {
      delete tracker.distance_home;
      delete tracker.at_home;
    }

    if (point.battery !== undefined) {
      const low = point.battery <= config.battery_low_threshold && point.charging !== true;
      if (low && !previous?.battery_low) {
        events.push([
          TRIGGERS.BATTERY_LOW,
          { device: common.device, device_name: tracker.name, battery: point.battery },
        ]);
        tracker.battery_low = true;
      } else if (
        point.charging === true ||
        point.battery > config.battery_low_threshold + BATTERY_HYSTERESIS
      ) {
        tracker.battery_low = false;
      }
    }

    events.unshift([
      TRIGGERS.POSITION_UPDATED,
      compact({
        ...common,
        accuracy: point.accuracy,
        speed: point.speed,
        battery: point.battery,
        distance_from_home:
          typeof tracker.distance_home === 'number'
            ? round(tracker.distance_home / 1000, 3)
            : undefined,
        maps_url: mapsUrl(point.latitude, point.longitude),
      }),
    ]);
    return events;
  }

  // --- Publication -----------------------------------------------------------

  async publish(tracker, { isNew = false, events = [] } = {}) {
    const steps = [];
    if (isNew) {
      steps.push(['discovery', () => this.publishDiscoveredDevices()]);
    }
    steps.push(['states', () => this.publishStates(tracker)]);
    steps.push(['transports', () => this.publishTransports([tracker])]);
    for (const [key, data] of events) {
      steps.push([`scene event ${key}`, () => this.gladys.publishSceneEvent(key, data)]);
    }
    // One failed publication must not prevent the others.
    for (const [label, step] of steps) {
      try {
        await step();
      } catch (err) {
        logger.error(`Publication of ${label} failed for ${tracker.id}`, err);
      }
    }
    this.refreshWidgets();
  }

  async publishDiscoveredDevices() {
    await this.gladys.publishDiscoveredDevices(
      this.store.list().map((tracker) => buildDevice(this.gladys, tracker)),
    );
  }

  /** States of a tracker, only once the user created its device. */
  async publishStates(tracker) {
    if (!this.isCreated(tracker)) {
      return;
    }
    const states = buildStates(this.gladys, tracker);
    if (states.length > 0) {
      await this.gladys.publishChangedStates(states, { heartbeat: STATE_HEARTBEAT_MS });
    }
  }

  async publishAllStates() {
    for (const tracker of this.store.list()) {
      try {
        await this.publishStates(tracker);
      } catch (err) {
        logger.error(`States of ${tracker.id} not published`, err);
      }
    }
  }

  /** Transport badge: the channel of the last position, or unreachable. */
  transportEntry(tracker) {
    if (this.isLost(tracker)) {
      return {
        external_id: this.deviceExternalId(tracker),
        transport: DEVICE_TRANSPORTS.UNREACHABLE,
      };
    }
    return {
      external_id: this.deviceExternalId(tracker),
      transport:
        tracker.channel === CHANNELS.CLOUD ? DEVICE_TRANSPORTS.CLOUD : DEVICE_TRANSPORTS.LOCAL,
    };
  }

  async publishTransports(trackers = this.store.list()) {
    const entries = trackers.filter((t) => this.isCreated(t)).map((t) => this.transportEntry(t));
    if (entries.length > 0) {
      await this.gladys.publishTransports(entries);
    }
  }

  refreshWidgets() {
    for (const key of this.widgetKeys ?? []) {
      this.gladys.requestWidgetRefresh(key);
    }
  }

  /** Recompute the home flags of every tracker (house moved, radius changed). */
  async recomputeHome() {
    const config = this.getConfig();
    const home = this.getHome();
    for (const tracker of this.store.list()) {
      if (!tracker.point) {
        continue;
      }
      if (home) {
        const distance = distanceMeters(home, tracker.point);
        tracker.distance_home = Math.round(distance);
        tracker.at_home = distance <= config.home_radius;
      } else {
        delete tracker.distance_home;
        delete tracker.at_home;
      }
      this.store.set(tracker);
    }
    await this.publishAllStates();
  }

  // --- Lost trackers ----------------------------------------------------------

  /** Flag the trackers that stopped reporting and fire `tracker_lost` once. */
  async checkLost() {
    const lost = [];
    for (const tracker of this.store.list()) {
      if (!tracker.lost && tracker.updated_at && this.isLost(tracker)) {
        tracker.lost = true;
        this.store.set(tracker);
        lost.push(tracker);
      }
    }
    for (const tracker of lost) {
      logger.info(`Tracker ${tracker.name} lost`);
      try {
        await this.gladys.publishSceneEvent(TRIGGERS.TRACKER_LOST, {
          device: this.deviceExternalId(tracker),
          device_name: tracker.name,
          minutes_since_update: Math.round(minutesSince(tracker, this.now())),
        });
      } catch (err) {
        logger.error(`Scene event tracker_lost failed for ${tracker.id}`, err);
      }
    }
    if (lost.length > 0) {
      await this.publishTransports(lost).catch((err) =>
        logger.error('Transport publication failed', err),
      );
      this.refreshWidgets();
    }
    return lost;
  }

  // --- Removal ---------------------------------------------------------------

  async forget(externalId) {
    const tracker = this.findByExternalId(externalId);
    if (!tracker) {
      return false;
    }
    this.store.delete(tracker.id);
    await this.publishDiscoveredDevices();
    this.refreshWidgets();
    return true;
  }
}

// Every trigger key the engine fires: checked against the manifest by the tests.
export const SCENE_TRIGGER_KEYS = Object.values(TRIGGERS);
