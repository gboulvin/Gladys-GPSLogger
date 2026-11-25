// Shared fixtures: a fake Gladys with a located house, and the app wired on it.
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../src/app.js';

// The house of the tests, in Paris.
export const HOME = { latitude: 48.8566, longitude: 2.3522 };
// About 5.5 km away (the Eiffel Tower is ~4 km, this is further east).
export const AWAY = { latitude: 48.8584, longitude: 2.2945 };

export const RECEIVER_CONTAINER_FIXTURE = {
  name: 'receiver',
  status: 'running',
  ports: [
    {
      container_port: 8080,
      protocol: 'tcp',
      host_port: 41234,
      label: { en: 'GPSLogger local receiver' },
      name: 'gpslogger',
      browsable: false,
    },
  ],
  devices: [],
};

/**
 * A connected fake Gladys running the integration.
 * @param {object} [options]
 */
export async function startApp({ config = {}, houses, clock, fetchImpl, ...fake } = {}) {
  const gladys = createFakeGladys({
    config: { local_receiver: false, ...config },
    houses: houses ?? [{ id: 'h1', name: 'Home', selector: 'home', ...HOME }],
    ...fake,
  });
  const app = registerHandlers(gladys, {
    dataDir: null,
    now: clock ? () => clock.now : undefined,
    fetchImpl: fetchImpl ?? (async () => ({ ok: true, json: async () => [] })),
  });
  await gladys.connect();
  return { gladys, app };
}

/** Simulate the user clicking "Add" on every discovered tracker. */
export async function createAllDevices(gladys) {
  for (const device of gladys.fake.discoveredDevices) {
    if (!gladys.devices.some((d) => d.external_id === device.external_id)) {
      await gladys.fake.deviceCreated(device);
    }
  }
}

/** A GPSLogger request as the local receiver relays it. */
export function gpsParams({ device = 'Alice Phone', ...rest } = {}) {
  return Object.fromEntries(
    Object.entries({ device, lat: AWAY.latitude, lon: AWAY.longitude, ...rest }).map(([k, v]) => [
      k,
      String(v),
    ]),
  );
}
