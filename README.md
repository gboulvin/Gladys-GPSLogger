# GPSLogger for Gladys Assistant

[![CI](https://github.com/gboulvin/Gladys-GPSLogger/actions/workflows/ci.yml/badge.svg)](https://github.com/gboulvin/Gladys-GPSLogger/actions/workflows/ci.yml)

External integration for [Gladys Assistant](https://gladysassistant.com) that
turns Android phones running the free, open-source
[GPSLogger](https://gpslogger.app) app into GPS trackers: position, distance
from home, home presence, battery, speed — with scene triggers and actions and
two dashboard widgets.

| Transport | How the positions arrive                                                           |
| --------- | ---------------------------------------------------------------------------------- |
| `local`   | A receiver sub-container publishes an HTTP port on the home network (Wi-Fi / VPN). |
| `cloud`   | A Gladys Plus webhook, to log from anywhere (4G/5G).                               |

User documentation: [English](docs/en.md) · [Français](docs/fr.md) ·
[Deutsch](docs/de.md) · [Español](docs/es.md).

## Features

- **Devices**: one tracker per phone (GPSLogger device name), discovered with
  its first position. Features: position (text), latitude, longitude, at
  home, distance from home, accuracy, altitude, speed, direction, battery,
  charging.
- **Scene triggers**: position received, arrived home, left home, phone
  battery low, tracker lost — each filterable by tracker, with variables
  (`{{triggerEvent.data.device_name}}`, `latitude`, `maps_url`…).
- **Scene actions**: get a tracker position, distance between two trackers,
  distance to a place (with an "inside the radius" output).
- **Dashboard widgets**: "GPS trackers" (every phone at a glance) and "GPS
  tracker" (one phone, live tiles, map link).
- **Configuration actions**: show the GPSLogger URLs, send a test position,
  forget a tracker.
- **Internationalization**: English, French, German and Spanish.
- Requests of a phone already set up for the Home Assistant GPSLogger
  integration are accepted as is.

Requires **Gladys 5.1.0** or later, and a house location set in Gladys for the
home features.

## Architecture

```
            home network                              Internet
 GPSLogger ──HTTP──▶ receiver sub-container   GPSLogger ──HTTPS──▶ Gladys Plus
                     (port published by Gladys)                    (webhook relay)
                          │ queue, drained every 3 s                    │
                          ▼ private network + secret                    ▼
                     ┌─────────────────── integration (SDK) ───────────────────┐
                     │ token check → parse → tracker store (/data)             │
                     │ → discovery, states, transport badge, scene events,     │
                     │   widget refresh                                        │
                     └──────────────────────────────────────────────────────────┘
```

The same Docker image runs both roles; `GPSLOGGER_ROLE=receiver` (set by the
manifest `containers` field) selects the receiver. The receiver holds no
Gladys credentials: it only queues the raw requests, and the integration
drains them with a secret it generated in `/data` and passed when starting the
sub-container.

```
index.js                role dispatch
src/app.js              SDK wiring (handlers registered before connect())
src/engine.js           position ingestion, home / battery / lost logic, publications
src/payload.js          GPSLogger request parsing
src/trackers.js         device and states of a tracker
src/store.js            /data/trackers.json
src/receiver.js         receiver HTTP server (sub-container)
src/relay.js            sub-container lifecycle + drain loop
src/actions.js          Configuration screen actions
src/scenes.js           scene actions
src/widgets.js          dashboard widgets
docs/                   user documentation (en, fr, de, es)
test/                   node --test against the SDK's fake Gladys
```

## Development

```bash
npm install
npm test               # unit tests (node --test)
npm run lint           # ESLint
npm run format:check   # Prettier
npx github:GladysAssistant/integration-store .   # store validation
```

Run it against a Gladys instance:

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="gpslogger" \
DATA_DIR=./data LOG_LEVEL=debug \
npm start
```

Run the receiver alone (port 8080):

```bash
GPSLOGGER_ROLE=receiver RELAY_SECRET=$(openssl rand -hex 32) npm start
```

See [`CLAUDE.md`](CLAUDE.md) for the project rules.

## Release

Describe the changes under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md),
then run **Actions → Release → Run workflow** (`patch`, `minor` or `major`).
The workflow bumps the version (package, manifest, main and sub-container
images), rolls the changelog, tags, builds the `linux/amd64` + `linux/arm64`
image to `ghcr.io/gboulvin/gladys-gpslogger`, and publishes the GitHub
Release.

The repository must carry the `gladys-assistant-integration` topic, so the Gladys
store indexer picks up each new version.

## Security

See [`SECURITY.md`](SECURITY.md) to report a vulnerability.

## License

Apache-2.0
