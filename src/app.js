// -----------------------------------------------------------------------------
// SDK wiring: every Gladys handler is registered here, BEFORE connect().
//
// Exported as a function of the SDK client so the tests run it against the
// fake Gladys of the SDK (`@gladysassistant/integration-sdk/testing`).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { ACTIONS, WEBHOOK_KEY } from './actions.js';
import { normalizeConfig } from './config.js';
import { TrackerEngine } from './engine.js';
import { LocalRelay } from './relay.js';
import { SCENE_ACTIONS } from './scenes.js';
import { TrackerStore } from './store.js';
import { trackerIdFromExternalId } from './trackers.js';
import { WIDGETS, WIDGET_KEYS } from './widgets.js';
import { parseRequest } from './payload.js';

const logger = createLogger({ name: 'gpslogger' });

const LOST_CHECK_INTERVAL_MS = 60 * 1000;

/** The first house of Gladys that has coordinates: "home". */
export function pickHome(houses) {
  const house = (houses ?? []).find(
    (h) => Number.isFinite(h?.latitude) && Number.isFinite(h?.longitude),
  );
  return house ? { latitude: house.latitude, longitude: house.longitude, name: house.name } : null;
}

/**
 * Register every handler on the SDK client.
 * @param {object} gladys GladysIntegration (or the fake one of the tests)
 * @param {object} [options]
 * @param {string | null} [options.dataDir] '/data' in the container, null in memory
 * @param {typeof fetch} [options.fetchImpl] fetch used to drain the receiver
 * @param {string} [options.receiverUrl] receiver base URL (tests)
 * @param {() => Date} [options.now]
 */
export function registerHandlers(gladys, options = {}) {
  const { dataDir = '/data', fetchImpl, receiverUrl, now } = options;
  let config = normalizeConfig();
  let home = null;
  let lostTimer = null;

  const store = new TrackerStore(dataDir).load();
  const engine = new TrackerEngine({
    gladys,
    store,
    getConfig: () => config,
    getHome: () => home,
    ...(now ? { now } : {}),
  });
  engine.widgetKeys = WIDGET_KEYS;
  const relay = new LocalRelay({
    gladys,
    engine,
    dataDir: dataDir ?? '/tmp',
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(receiverUrl ? { baseUrl: receiverUrl } : {}),
  });

  async function loadHome() {
    try {
      home = pickHome(await gladys.getHouses());
      if (!home) {
        logger.warn('No house with a location in Gladys: home presence is disabled');
      }
    } catch (err) {
      logger.error('Could not read the house location', err);
    }
  }

  // --- Discovery ---------------------------------------------------------------
  gladys.onScanRequest(async () => {
    await engine.publishDiscoveredDevices();
  });

  // --- Device lifecycle --------------------------------------------------------
  // States of a tracker are only published once its device exists: send the
  // last known position as soon as the user creates it.
  gladys.onDeviceCreated(async (device) => {
    const tracker = engine.findByExternalId(device.external_id);
    if (tracker) {
      await engine.publishStates(tracker);
      await engine.publishTransports([tracker]);
    }
  });

  gladys.onDeviceDeleted(async (device) => {
    const id = trackerIdFromExternalId(gladys, device.external_id);
    if (id) {
      logger.info(`Device of tracker ${id} deleted`);
    }
  });

  // --- GPSLogger through Gladys Plus (cloud) -----------------------------------
  // `sync` mode: GPSLogger gets our answer, so a wrong token is a visible 401
  // in its log instead of a silent success.
  gladys.onWebhook(WEBHOOK_KEY, async ({ query, body, contentType }) => {
    const result = await engine.ingest(parseRequest({ query, body, contentType }), {
      channel: 'cloud',
    });
    return { status: result.status, contentType: 'text/plain', body: result.message };
  });

  gladys.onWebhookUpdated(async ({ available }) => {
    logger.info(`Gladys Plus webhooks ${available ? 'available' : 'unavailable'}`);
  });

  // --- Manifest actions --------------------------------------------------------
  for (const [key, handler] of Object.entries(ACTIONS)) {
    gladys.onAction(key, (fields) => handler(gladys, { fields, config, engine }));
  }

  // --- Scene actions -----------------------------------------------------------
  for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(key, (fields) => handler(engine, { fields, config }));
  }

  // --- Dashboard widgets -------------------------------------------------------
  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(key, (request) => widget.get(engine, { ...request, config }));
  }

  // --- Configuration -----------------------------------------------------------
  gladys.onConfigUpdated(async (newConfig) => {
    const previousRadius = config.home_radius;
    config = normalizeConfig(newConfig);
    await relay.apply(config);
    if (config.home_radius !== previousRadius) {
      await engine.recomputeHome();
    }
    await engine.publishTransports().catch((err) => logger.error('Transports failed', err));
    engine.refreshWidgets();
  });

  // --- Connection lifecycle ----------------------------------------------------
  gladys.on('connected', async () => {
    try {
      config = normalizeConfig(await gladys.getConfig());
      await loadHome();
      await engine.publishDiscoveredDevices();
      await engine.publishAllStates();
      await engine.publishTransports();
      await relay.apply(config);
      clearInterval(lostTimer);
      lostTimer = setInterval(() => {
        engine.checkLost().catch((err) => logger.error('Lost check failed', err));
      }, LOST_CHECK_INTERVAL_MS);
      lostTimer.unref?.();
      engine.refreshWidgets();
      await gladys.setConnectionStatus(true);
    } catch (err) {
      logger.error('Post-connection initialization failed', err);
      await gladys
        .setConnectionStatus(false, {
          en: 'Initialization failed, check the integration logs.',
          fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
          de: 'Initialisierung fehlgeschlagen, prüfen Sie die Logs der Integration.',
          es: 'La inicialización falló, consulte los registros de la integración.',
        })
        .catch(() => {});
    }
  });

  // While Gladys is unreachable, positions stay queued in the receiver.
  gladys.on('disconnected', () => {
    relay.pause();
    clearInterval(lostTimer);
    lostTimer = null;
  });

  function stop() {
    relay.pause();
    clearInterval(lostTimer);
    lostTimer = null;
    store.flush();
  }

  return { engine, relay, store, stop, getConfig: () => config };
}
