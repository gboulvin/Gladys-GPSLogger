// -----------------------------------------------------------------------------
// Dashboard widgets (manifest `widgets`, Gladys 5.1+).
//
// The integration returns a DECLARATIVE content (card-list, status, value
// tiles, buttons) that the core renders with its own theme and dark mode.
// Texts are multi-language objects: the core picks the viewer's language.
//
//   - trackers_overview: every phone at a glance (home or away, distance,
//     battery, last update), a tap opens the details and a map link;
//   - tracker_status: one phone (widget setting `device`), with LIVE tiles
//     bound to its device features once the user created the device.
//
// The engine nudges both widgets (requestWidgetRefresh) on every position.
// -----------------------------------------------------------------------------

import { createLogger, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { minutesSince } from './engine.js';
import { formatCoordinates, mapsUrl } from './geo.js';
import { ago, formatDistance, TEXTS } from './i18n.js';
import { FEATURE, featureExternalId } from './trackers.js';

const logger = createLogger({ name: 'widgets' });

export const OVERVIEW_WIDGET = 'trackers_overview';
export const TRACKER_WIDGET = 'tracker_status';

const MAX_LIST_ITEMS = 8;
const OPEN_MAP = {
  en: 'Open the map',
  fr: 'Ouvrir la carte',
  de: 'Karte öffnen',
  es: 'Abrir el mapa',
};

function batteryColor(battery) {
  if (battery === undefined) {
    return WIDGET_COLORS.NEUTRAL;
  }
  if (battery <= 15) {
    return WIDGET_COLORS.DANGER;
  }
  return battery <= 30 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS;
}

/** Where the tracker is, as a short multi-language text and a color. */
function presence(engine, tracker, units) {
  if (engine.isLost(tracker)) {
    return { text: TEXTS.lost, color: WIDGET_COLORS.DANGER };
  }
  if (tracker.at_home === true) {
    return { text: TEXTS.home, color: WIDGET_COLORS.SUCCESS };
  }
  if (typeof tracker.distance_home === 'number') {
    const distance = formatDistance(tracker.distance_home, units);
    return {
      text: {
        en: `${TEXTS.away.en} · ${distance}`,
        fr: `${TEXTS.away.fr} · ${distance}`,
        de: `${TEXTS.away.de} · ${distance}`,
        es: `${TEXTS.away.es} · ${distance}`,
      },
      color: WIDGET_COLORS.INFO,
    };
  }
  return { text: TEXTS.unknown, color: WIDGET_COLORS.NEUTRAL };
}

function details(tracker) {
  const { point } = tracker;
  const lines = (labels) =>
    [
      `${labels.position}: ${formatCoordinates(point.latitude, point.longitude)}`,
      point.accuracy !== undefined ? `${labels.accuracy}: ${Math.round(point.accuracy)} m` : null,
      point.speed !== undefined ? `${labels.speed}: ${point.speed} km/h` : null,
      point.battery !== undefined ? `${labels.battery}: ${point.battery} %` : null,
      point.provider ? `${labels.provider}: ${point.provider}` : null,
    ]
      .filter(Boolean)
      .join('\n');
  return {
    en: lines({
      position: 'Position',
      accuracy: 'Accuracy',
      speed: 'Speed',
      battery: 'Battery',
      provider: 'Source',
    }),
    fr: lines({
      position: 'Position',
      accuracy: 'Précision',
      speed: 'Vitesse',
      battery: 'Batterie',
      provider: 'Source',
    }),
    de: lines({
      position: 'Position',
      accuracy: 'Genauigkeit',
      speed: 'Tempo',
      battery: 'Akku',
      provider: 'Quelle',
    }),
    es: lines({
      position: 'Posición',
      accuracy: 'Precisión',
      speed: 'Velocidad',
      battery: 'Batería',
      provider: 'Fuente',
    }),
  };
}

const EMPTY_TEXT = {
  en: 'No position received yet. Set up GPSLogger on a phone (see the integration page), or send a test position.',
  fr: "Aucune position reçue. Configurez GPSLogger sur un téléphone (voir la page de l'intégration) ou envoyez une position de test.",
  de: 'Noch keine Position empfangen. Richten Sie GPSLogger auf einem Handy ein (siehe Integrationsseite) oder senden Sie eine Testposition.',
  es: 'Aún no se ha recibido ninguna posición. Configure GPSLogger en un teléfono (vea la página de la integración) o envíe una posición de prueba.',
};

export const WIDGETS = {
  [OVERVIEW_WIDGET]: {
    async get(engine, { units }) {
      logger.debug(`onWidgetGet <- ${OVERVIEW_WIDGET}`);
      const trackers = engine.store.list().filter((t) => t.point);
      if (trackers.length === 0) {
        return {
          ttl_seconds: 300,
          components: [{ type: 'text', variant: 'body', text: EMPTY_TEXT }],
        };
      }
      // Most recent first: a dashboard shows what matters now.
      trackers.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      const atHome = trackers.filter((t) => t.at_home === true && !engine.isLost(t)).length;
      return {
        // Every position nudges the widget; the TTL refreshes "x min ago".
        ttl_seconds: 120,
        components: [
          {
            type: 'card-list',
            display: 'list',
            items: trackers.slice(0, MAX_LIST_ITEMS).map((tracker) => {
              const { text, color } = presence(engine, tracker, units);
              const { battery } = tracker.point;
              return {
                title: tracker.name.slice(0, 60),
                subtitle: text,
                date: tracker.updated_at,
                badge:
                  battery !== undefined
                    ? { text: `${battery} %`, color: batteryColor(battery) }
                    : { text: TEXTS.unknown, color },
                description: details(tracker),
                links: [
                  {
                    url: mapsUrl(tracker.point.latitude, tracker.point.longitude),
                    label: OPEN_MAP,
                  },
                ],
              };
            }),
          },
          {
            type: 'status',
            items: [
              {
                label: { en: 'At home', fr: 'À la maison', de: 'Zu Hause', es: 'En casa' },
                icon: 'home',
                value: `${atHome} / ${trackers.length}`,
                color: atHome > 0 ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
              },
            ],
          },
        ],
      };
    },
  },

  [TRACKER_WIDGET]: {
    async get(engine, { settings, units }) {
      logger.debug(`onWidgetGet <- ${TRACKER_WIDGET}`);
      const tracker = engine.findByExternalId(settings?.device);
      if (!tracker?.point) {
        return {
          ttl_seconds: 300,
          components: [{ type: 'text', variant: 'body', text: EMPTY_TEXT }],
        };
      }
      const { point } = tracker;
      const { text, color } = presence(engine, tracker, units);
      const minutes = minutesSince(tracker, engine.now());
      const feature = (key) => featureExternalId(engine.gladys, tracker.id, key);
      // Live tiles follow the published states, but only exist once the user
      // created the device: before that, inline values.
      const live = engine.isCreated(tracker);
      const tile = (key, label, icon, value, unit) =>
        live
          ? { type: 'value', device_feature: feature(key), label, icon }
          : value === undefined
            ? null
            : { type: 'value', value, unit, label, icon };
      const components = [
        { type: 'text', variant: 'heading', text: tracker.name.slice(0, 40) },
        tile(
          FEATURE.DISTANCE_HOME,
          { en: 'From home', fr: 'Du domicile', de: 'Von zu Hause', es: 'Desde casa' },
          'home',
          typeof tracker.distance_home === 'number'
            ? Math.round(tracker.distance_home / 100) / 10
            : undefined,
          'km',
        ),
        tile(
          FEATURE.BATTERY,
          { en: 'Battery', fr: 'Batterie', de: 'Akku', es: 'Batería' },
          'battery',
          point.battery,
          '%',
        ),
        tile(
          FEATURE.SPEED,
          { en: 'Speed', fr: 'Vitesse', de: 'Tempo', es: 'Velocidad' },
          'navigation',
          point.speed,
          'km/h',
        ),
        {
          type: 'status',
          items: [
            {
              label: { en: 'Presence', fr: 'Présence', de: 'Anwesenheit', es: 'Presencia' },
              icon: 'map-pin',
              value: text,
              color,
            },
            {
              label: {
                en: 'Last position',
                fr: 'Dernière position',
                de: 'Letzte Position',
                es: 'Última posición',
              },
              icon: 'clock',
              value: ago(minutes ?? 0),
              color: engine.isLost(tracker) ? WIDGET_COLORS.DANGER : WIDGET_COLORS.NEUTRAL,
            },
            {
              label: { en: 'Coordinates', fr: 'Coordonnées', de: 'Koordinaten', es: 'Coordenadas' },
              icon: 'crosshair',
              value: formatCoordinates(point.latitude, point.longitude),
              color: WIDGET_COLORS.NEUTRAL,
            },
            ...(point.accuracy !== undefined
              ? [
                  {
                    label: { en: 'Accuracy', fr: 'Précision', de: 'Genauigkeit', es: 'Precisión' },
                    icon: 'target',
                    value: formatDistance(point.accuracy, units),
                    color: point.accuracy > 100 ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
                  },
                ]
              : []),
            {
              label: {
                en: 'Received via',
                fr: 'Reçu via',
                de: 'Empfangen über',
                es: 'Recibido por',
              },
              icon: tracker.channel === 'cloud' ? 'cloud' : 'wifi',
              value: tracker.channel === 'cloud' ? TEXTS.cloud : TEXTS.local,
              color: WIDGET_COLORS.INFO,
            },
          ],
        },
        {
          type: 'button',
          label: OPEN_MAP,
          icon: 'map',
          style: 'primary',
          link: { url: mapsUrl(point.latitude, point.longitude) },
        },
      ].filter(Boolean);
      return { ttl_seconds: 120, components };
    },
  },
};

export const WIDGET_KEYS = Object.keys(WIDGETS);
