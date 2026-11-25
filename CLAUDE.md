# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for the
[GPSLogger](https://gpslogger.app) Android app: a Node.js service (Node 22+,
ESM, no build step) that runs in its own sandboxed Docker container and talks
to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template
(`GladysAssistant/integration-template-js`).

Every phone running GPSLogger becomes a tracker device. GPSLogger pushes its
positions to a URL; the integration receives them two ways:

- **local**: the `receiver` sub-container (same image, `GPSLOGGER_ROLE=receiver`)
  publishes an HTTP port on the LAN and queues the raw requests; the
  integration drains the queue over the private network
  (`GET http://receiver:8080/internal/drain`, header `x-relay-secret`);
- **cloud**: the `gpslogger` webhook relayed by Gladys Plus (`sync` mode, so
  GPSLogger sees a 401 on a wrong token).

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/engine.test.js           # one file
node --test --test-name-pattern "home"    # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                role dispatch: integration (default) or receiver (GPSLOGGER_ROLE)
src/app.js              SDK wiring: every handler registered before connect()
src/engine.js           TrackerEngine: ingest a position, home/battery/lost flags,
                        publications (discovery, states, transports, scene events)
src/payload.js          GPSLogger request parsing (GPSLogger + Home Assistant names)
src/trackers.js         device blueprint of a tracker, feature keys, states
src/store.js            /data/trackers.json (last position + flags, survives restarts)
src/receiver.js         HTTP server of the receiver sub-container
src/relay.js            starts the sub-container, drains its queue
src/actions.js          manifest `actions` (Configuration screen buttons)
src/scenes.js           manifest `scene_actions`
src/widgets.js          manifest `widgets`
src/config.js           DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
src/geo.js, src/i18n.js distance / map links, multi-language texts
gladys-assistant-integration.json   manifest
docs/{en,fr,de,es}.md   user documentation, re-hosted by Gladys (mandatory)
test/                   node --test, against the SDK's fake Gladys (integration-sdk/testing)
.github/scripts/release.mjs   release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **External ids are forever.** A tracker is
  `gladys.externalIds('tracker', trackerIdFromName(deviceName))`: never change
  `TRACKER_TYPE`, the `FEATURE` keys or `trackerIdFromName` output for an
  existing input. The same goes for every key users store: manifest
  `config_schema`, `actions`, `webhooks`, widget and scene keys, the
  `receiver` container name and its port name `gpslogger`.
- **The device structure is fixed.** Every tracker declares all its features
  whatever the phone sends; adding a feature shows an "Update" button to every
  user: do it on purpose, with a changelog line.
- **Every feature carries `name`, `min`, `max`, `read_only` and
  `has_feedback`** (Gladys stores them NOT NULL); the tests check it.
- **States only for created devices.** Gladys drops the states of a device the
  user has not added; `onDeviceCreated` publishes the last known position.
- **The receiver stays dumb.** It holds no Gladys credentials and no logic: it
  queues raw requests. Token check and parsing happen in the integration.
- **The container rootfs is read-only.** Write only under `/data`. Positions
  are personal data: never log more than the device name and coordinates,
  never log tokens or the relay secret.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tags
  (main image and `receiver` sub-container), by hand. `test/manifest.test.js`
  checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section.
- **Manifest.** Texts are multi-language objects with **`en`, `fr`, `de` and
  `es`** (checked by `test/manifest.test.js`): `label`, `description` and
  `placeholder` alike, never a plain string. The catalog `description` holds
  10 to 100 characters per language. Keep `gladys_version` at `>=5.1.0`
  (widgets, scene triggers/actions); `keywords`/`countries` would need 5.3.0
  and `source: "houses"` 5.2.0.
- **User-facing text** exists in the four languages: action messages, widget
  texts (`src/i18n.js`), manifest texts, and `docs/en.md`, `docs/fr.md`,
  `docs/de.md`, `docs/es.md`, kept in sync.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network (the receiver tests listen on
  127.0.0.1 only).
