// -----------------------------------------------------------------------------
// Integration configuration.
//
// The configuration is filled in by the user in Gladys, from the `config_schema`
// declared in `gladys-assistant-integration.json`. This module only provides
// the defaults and normalizes the received object (types, bounds), so the rest
// of the code never deals with `undefined` or a number typed as a string.
// -----------------------------------------------------------------------------

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest (checked by test/manifest.test.js).
export const DEFAULT_CONFIG = {
  // Run the "receiver" sub-container, which publishes an HTTP port on the LAN.
  local_receiver: true,
  // Optional shared secret every GPSLogger request must carry. Empty = none.
  token: '',
  // Meters around the Gladys house location that count as "home".
  home_radius: 150,
  // Battery percentage at or below which the `battery_low` trigger fires.
  battery_low_threshold: 20,
  // Minutes without any position before a tracker is "lost".
  stale_minutes: 60,
  // Reserved key (NOT in config_schema): the manifest declares both 'local'
  // and 'cloud' transports, so Gladys shows its standard "Prefer the local
  // connection" toggle. GPSLogger decides where it posts, so the value is only
  // read, never acted upon (see docs/en.md).
  GLADYS_PREFER_LOCAL: true,
};

function boundedNumber(value, fallback, min, max) {
  const number = Number(value);
  if (value === null || value === '' || !Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, number));
}

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    local_receiver: raw.local_receiver !== false && raw.local_receiver !== 'false',
    token: typeof raw.token === 'string' ? raw.token.trim() : '',
    home_radius: boundedNumber(raw.home_radius, DEFAULT_CONFIG.home_radius, 20, 5000),
    battery_low_threshold: boundedNumber(
      raw.battery_low_threshold,
      DEFAULT_CONFIG.battery_low_threshold,
      1,
      99,
    ),
    stale_minutes: boundedNumber(raw.stale_minutes, DEFAULT_CONFIG.stale_minutes, 5, 1440),
    GLADYS_PREFER_LOCAL: raw.GLADYS_PREFER_LOCAL !== false,
  };
}
