// -----------------------------------------------------------------------------
// Relay between the local receiver sub-container and the integration.
//
// The integration starts the `receiver` sub-container (manifest `containers`,
// `start: "manual"`) with a random secret, then drains its queue every few
// seconds over the private network of the integration, where the
// sub-container answers on its name ("receiver"). Draining stops while Gladys
// is disconnected, so no position is lost: the receiver keeps them queued.
// -----------------------------------------------------------------------------

import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';
import { CHANNELS } from './engine.js';
import { parseRequest } from './payload.js';
import { DRAIN_PATH, RECEIVER_PORT, SECRET_HEADER } from './receiver.js';

const logger = createLogger({ name: 'relay' });

// Name of the sub-container in the manifest `containers` field.
export const RECEIVER_CONTAINER = 'receiver';
const DRAIN_INTERVAL_MS = 3000;
const SECRET_FILE = 'relay-secret';

/** Read the relay secret from /data, or create it. */
export function loadOrCreateSecret(dataDir) {
  const file = join(dataDir, SECRET_FILE);
  try {
    const secret = readFileSync(file, 'utf8').trim();
    if (secret.length >= 32) {
      return secret;
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      logger.error('Could not read the relay secret, creating a new one', err);
    }
  }
  const secret = randomBytes(32).toString('hex');
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

export class LocalRelay {
  /**
   * @param {object} options
   * @param {object} options.gladys SDK client
   * @param {import('./engine.js').TrackerEngine} options.engine
   * @param {string} options.dataDir
   * @param {typeof fetch} [options.fetchImpl]
   * @param {string} [options.baseUrl] receiver URL (tests)
   * @param {number} [options.intervalMs]
   */
  constructor({
    gladys,
    engine,
    dataDir,
    fetchImpl = fetch,
    baseUrl = `http://${RECEIVER_CONTAINER}:${RECEIVER_PORT}`,
    intervalMs = DRAIN_INTERVAL_MS,
  }) {
    this.gladys = gladys;
    this.engine = engine;
    this.dataDir = dataDir;
    this.fetchImpl = fetchImpl;
    this.baseUrl = baseUrl;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.draining = false;
    this.enabled = false;
    this.lastError = null;
  }

  get secret() {
    this.cachedSecret ??= loadOrCreateSecret(this.dataDir);
    return this.cachedSecret;
  }

  /** Start or stop the sub-container and the drain loop, per the config. */
  async apply(config) {
    if (config.local_receiver) {
      try {
        await this.gladys.startContainer(RECEIVER_CONTAINER, {
          env: { RELAY_SECRET: this.secret },
        });
      } catch (err) {
        logger.error('Could not start the local receiver', err);
      }
      this.enabled = true;
      this.resume();
    } else {
      this.enabled = false;
      this.pause();
      try {
        await this.gladys.stopContainer(RECEIVER_CONTAINER);
      } catch (err) {
        logger.debug(`Local receiver not stopped: ${err.message}`);
      }
    }
  }

  resume() {
    if (!this.enabled || this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      this.drainOnce().catch((err) => logger.error('Drain failed', err));
    }, this.intervalMs);
    this.timer.unref?.();
  }

  pause() {
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Fetch the queued requests and ingest them. Resolves the count. */
  async drainOnce() {
    if (this.draining) {
      return 0;
    }
    this.draining = true;
    try {
      let items;
      try {
        const res = await this.fetchImpl(`${this.baseUrl}${DRAIN_PATH}`, {
          headers: { [SECRET_HEADER]: this.secret },
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) {
          throw new Error(`receiver answered HTTP ${res.status}`);
        }
        items = await res.json();
        this.lastError = null;
      } catch (err) {
        // The sub-container may still be starting: log once per error kind.
        if (this.lastError !== err.message) {
          logger.warn(`Local receiver unreachable: ${err.message}`);
          this.lastError = err.message;
        }
        return 0;
      }
      for (const item of Array.isArray(items) ? items : []) {
        await this.engine.ingest(parseRequest(item), {
          channel: CHANNELS.LOCAL,
          authorization: item.authorization,
          receivedAt: item.received_at,
        });
      }
      return Array.isArray(items) ? items.length : 0;
    } finally {
      this.draining = false;
    }
  }
}
