// -----------------------------------------------------------------------------
// Manifest actions: the buttons of the Configuration screen. Each handler
// resolves the multi-language message displayed under its button.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { CHANNELS } from './engine.js';
import { RECEIVER_CONTAINER } from './relay.js';

const logger = createLogger({ name: 'actions' });

// Key of the webhook declared in the manifest `webhooks` field.
export const WEBHOOK_KEY = 'gpslogger';

const QUERY_HINT =
  '?device=%DEVNAME&lat=%LAT&lon=%LON&acc=%ACC&alt=%ALT&spd=%SPD&dir=%DIR&batt=%BATT&ischarging=%ISCHARGING&time=%TIME';

async function localPort(gladys) {
  try {
    const containers = await gladys.getContainers();
    const receiver = containers.find((c) => c.name === RECEIVER_CONTAINER);
    return receiver?.ports?.find((p) => p.container_port === 8080)?.host_port ?? null;
  } catch (err) {
    logger.debug(`Containers not readable: ${err.message}`);
    return null;
  }
}

async function cloudUrl(gladys) {
  try {
    const { available, webhooks } = await gladys.getWebhooks();
    return available ? (webhooks.find((w) => w.key === WEBHOOK_KEY)?.url ?? null) : null;
  } catch (err) {
    logger.debug(`Webhooks not readable: ${err.message}`);
    return null;
  }
}

export const ACTIONS = {
  async show_urls(gladys, { config }) {
    const [port, cloud] = await Promise.all([localPort(gladys), cloudUrl(gladys)]);
    const local = config.local_receiver && port ? `http://<gladys-ip>:${port}/log` : null;
    const tokenHint = config.token ? '&token=<token>' : '';
    const lines = (texts) =>
      [
        local ? `${texts.local}: ${local}` : texts.noLocal,
        cloud ? `${texts.cloud}: ${cloud}` : texts.noCloud,
        `${texts.params}: ${QUERY_HINT}${tokenHint}`,
      ].join('\n');
    return {
      en: lines({
        local: 'Local URL',
        noLocal: 'Local receiver off or not started yet.',
        cloud: 'Cloud URL',
        noCloud: 'Cloud URL: link Gladys Plus in the "Gladys Plus webhooks" block first.',
        params: 'Parameters to append (GET) or send as body (POST)',
      }),
      fr: lines({
        local: 'URL locale',
        noLocal: 'Récepteur local désactivé ou pas encore démarré.',
        cloud: 'URL cloud',
        noCloud: "URL cloud : liez d'abord Gladys Plus dans le bloc « Webhooks Gladys Plus ».",
        params: 'Paramètres à ajouter (GET) ou à envoyer dans le corps (POST)',
      }),
      de: lines({
        local: 'Lokale URL',
        noLocal: 'Lokaler Empfänger aus oder noch nicht gestartet.',
        cloud: 'Cloud-URL',
        noCloud: 'Cloud-URL: verknüpfen Sie zuerst Gladys Plus im Block „Gladys Plus Webhooks“.',
        params: 'Anzuhängende Parameter (GET) oder als Body (POST)',
      }),
      es: lines({
        local: 'URL local',
        noLocal: 'Receptor local desactivado o aún no iniciado.',
        cloud: 'URL en la nube',
        noCloud:
          'URL en la nube: vincule primero Gladys Plus en el bloque «Webhooks de Gladys Plus».',
        params: 'Parámetros a añadir (GET) o a enviar en el cuerpo (POST)',
      }),
    };
  },

  async send_test_position(_gladys, { fields, engine }) {
    const params = {
      device: String(fields.device_name ?? ''),
      lat: String(fields.latitude ?? ''),
      lon: String(fields.longitude ?? ''),
    };
    if (fields.battery !== undefined && fields.battery !== null) {
      params.batt = String(fields.battery);
    }
    const result = await engine.ingest(params, { channel: CHANNELS.LOCAL, trusted: true });
    if (result.status !== 200) {
      throw new Error(result.message);
    }
    const name = result.tracker.name;
    return {
      en: `Position sent for "${name}". Add the tracker from the Discovery tab if it is new.`,
      fr: `Position envoyée pour « ${name} ». Ajoutez le traceur depuis l'onglet Découverte s'il est nouveau.`,
      de: `Position für „${name}“ gesendet. Fügen Sie den Tracker im Reiter „Erkennung“ hinzu, falls er neu ist.`,
      es: `Posición enviada para «${name}». Añada el rastreador desde la pestaña Descubrimiento si es nuevo.`,
    };
  },

  async forget_tracker(_gladys, { fields, engine }) {
    const forgotten = await engine.forget(fields.device);
    if (!forgotten) {
      return {
        en: 'This tracker is unknown.',
        fr: 'Ce traceur est inconnu.',
        de: 'Dieser Tracker ist unbekannt.',
        es: 'Este rastreador es desconocido.',
      };
    }
    return {
      en: 'Tracker forgotten. Delete its device in Gladys too; it comes back with its next position.',
      fr: 'Traceur oublié. Supprimez aussi son appareil dans Gladys ; il reviendra à sa prochaine position.',
      de: 'Tracker vergessen. Löschen Sie auch sein Gerät in Gladys; er kommt mit seiner nächsten Position zurück.',
      es: 'Rastreador olvidado. Elimine también su dispositivo en Gladys; volverá con su próxima posición.',
    };
  },
};
