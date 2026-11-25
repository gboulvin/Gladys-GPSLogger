// -----------------------------------------------------------------------------
// Parsing of the requests GPSLogger sends.
//
// GPSLogger ("Log to custom URL") calls a URL of the user's choice with the
// placeholders it resolves (%LAT, %LON, %BATT...), as query parameters (GET)
// or as a body (POST, form-encoded or JSON). Both the GPSLogger short names
// (lat, lon, batt...) and the long names of the Home Assistant setup
// (latitude, longitude, battery...) are accepted, so a phone already set up
// for Home Assistant works as is.
// -----------------------------------------------------------------------------

// Accepted parameter names, first match wins.
const ALIASES = {
  device: ['device', 'dev', 'devname', 'device_name', 'name', 'id', 'aid', 'ser'],
  latitude: ['latitude', 'lat'],
  longitude: ['longitude', 'lon', 'lng', 'long'],
  accuracy: ['accuracy', 'acc'],
  altitude: ['altitude', 'alt'],
  speed: ['speed', 'spd'],
  direction: ['direction', 'dir', 'bearing'],
  battery: ['battery', 'batt', 'bat'],
  charging: ['charging', 'ischarging', 'is_charging'],
  provider: ['provider', 'prov'],
  activity: ['activity', 'act'],
  satellites: ['satellites', 'sat'],
  timestamp: ['timestamp', 'time'],
  token: ['token', 'key', 'access_token'],
};

export const MAX_DEVICE_NAME_LENGTH = 64;
const MAX_TRACKER_ID_LENGTH = 40;
// A phone whose clock runs ahead is not trusted beyond this.
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * Merge the query string and the body of a request into one flat object of
 * lower-cased keys. The body can be a form-encoded string, a JSON string or an
 * already-parsed object (the Gladys Plus relay may parse it).
 */
export function parseRequest({ query, body, contentType } = {}) {
  const params = {};
  const assign = (source) => {
    for (const [key, value] of Object.entries(source ?? {})) {
      if (value !== undefined && value !== null && typeof value !== 'object') {
        params[key.toLowerCase()] = String(value);
      }
    }
  };
  assign(query);
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
    assign(body);
  } else if (body !== undefined && body !== null) {
    const text = String(body).trim();
    const isJson = /json/i.test(contentType ?? '') || text.startsWith('{');
    if (isJson) {
      try {
        assign(JSON.parse(text));
      } catch {
        // Not JSON after all: fall back to the form encoding below.
        assign(Object.fromEntries(new URLSearchParams(text)));
      }
    } else if (text) {
      assign(Object.fromEntries(new URLSearchParams(text)));
    }
  }
  return params;
}

/** First non-empty value among the aliases of a field. */
function pick(params, field) {
  for (const name of ALIASES[field]) {
    const value = params[name];
    // An unresolved GPSLogger placeholder ("%BATT") means "not available".
    if (value !== undefined && value !== '' && !value.startsWith('%')) {
      return value;
    }
  }
  return undefined;
}

function pickNumber(params, field) {
  const raw = pick(params, field);
  if (raw === undefined) {
    return undefined;
  }
  const number = Number.parseFloat(raw.replace(',', '.'));
  return Number.isFinite(number) ? number : undefined;
}

function pickBoolean(params, field) {
  const raw = pick(params, field);
  if (raw === undefined) {
    return undefined;
  }
  return ['true', '1', 'yes', 'on'].includes(raw.toLowerCase());
}

/** The access token carried by a request, if any. */
export function extractToken(params, authorization) {
  const fromParams = pick(params, 'token');
  if (fromParams) {
    return fromParams;
  }
  const match = /^Bearer\s+(.+)$/i.exec(authorization ?? '');
  return match ? match[1].trim() : undefined;
}

/**
 * Stable tracker id from the device name GPSLogger sends: lower case, ASCII
 * letters, digits and dashes. It ends up in the device external_id, which is
 * forever: never change this function's output for an existing input.
 */
export function trackerIdFromName(name) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_TRACKER_ID_LENGTH)
    .replace(/-+$/g, '');
}

function parseTimestamp(raw, now) {
  if (raw === undefined) {
    return now;
  }
  let date;
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const number = Number(raw);
    // Seconds (GPSLogger %TIMESTAMP) or milliseconds.
    date = new Date(number < 1e12 ? number * 1000 : number);
  } else {
    date = new Date(raw);
  }
  if (Number.isNaN(date.getTime()) || date.getTime() > now.getTime() + MAX_CLOCK_SKEW_MS) {
    return now;
  }
  return date;
}

const inRange = (value, min, max) => value !== undefined && value >= min && value <= max;
const keepInRange = (value, min, max) => (inRange(value, min, max) ? value : undefined);

/**
 * Turn the request parameters into a position.
 * @returns {{ ok: true, point: object } | { ok: false, reason: string }}
 */
export function parsePoint(params, now = new Date()) {
  const name = pick(params, 'device')?.trim().slice(0, MAX_DEVICE_NAME_LENGTH);
  if (!name) {
    return { ok: false, reason: 'missing device name (add device=%DEVNAME to the URL)' };
  }
  const id = trackerIdFromName(name);
  if (!id) {
    return { ok: false, reason: `invalid device name "${name}"` };
  }
  const latitude = pickNumber(params, 'latitude');
  const longitude = pickNumber(params, 'longitude');
  if (!inRange(latitude, -90, 90) || !inRange(longitude, -180, 180)) {
    return { ok: false, reason: 'missing or invalid latitude/longitude' };
  }
  if (latitude === 0 && longitude === 0) {
    return { ok: false, reason: 'position 0,0 ignored (no GPS fix)' };
  }
  const speedMs = keepInRange(pickNumber(params, 'speed'), 0, 350);
  const battery = keepInRange(pickNumber(params, 'battery'), 0, 100);
  const point = {
    name,
    id,
    latitude,
    longitude,
    accuracy: keepInRange(pickNumber(params, 'accuracy'), 0, 100_000),
    altitude: keepInRange(pickNumber(params, 'altitude'), -500, 10_000),
    // GPSLogger sends meters per second; Gladys shows km/h.
    speed: speedMs === undefined ? undefined : Math.round(speedMs * 3.6 * 10) / 10,
    direction: keepInRange(pickNumber(params, 'direction'), 0, 360),
    battery: battery === undefined ? undefined : Math.round(battery),
    charging: pickBoolean(params, 'charging'),
    provider: pick(params, 'provider')?.slice(0, 20),
    activity: pick(params, 'activity')?.slice(0, 40),
    satellites: keepInRange(pickNumber(params, 'satellites'), 0, 200),
    timestamp: parseTimestamp(pick(params, 'timestamp'), now).toISOString(),
  };
  for (const key of Object.keys(point)) {
    if (point[key] === undefined) {
      delete point[key];
    }
  }
  return { ok: true, point };
}
