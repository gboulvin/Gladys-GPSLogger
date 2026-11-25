# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.0] - 2026-11-25

### Added

- First release of the GPSLogger integration: every Android phone running the
  GPSLogger app becomes a GPS tracker in Gladys (position, latitude,
  longitude, home presence, distance from home, accuracy, altitude, speed,
  direction, battery, charging).
- Two ways to receive the positions: a local receiver on the home network
  (`local` transport, a sub-container publishing an HTTP port) and a Gladys
  Plus webhook to log from anywhere (`cloud` transport). The device badge
  shows the channel of the last position, or "unreachable" once lost.
- Optional access token, checked on both channels.
- Home presence from the house location set in Gladys, with an exit margin so
  GPS jitter does not flap.
- Scene triggers: position received, arrived home, left home, phone battery
  low, tracker lost.
- Scene actions: get a tracker position, distance between two trackers,
  distance to a place.
- Dashboard widgets: "GPS trackers" (every phone at a glance) and "GPS
  tracker" (one phone, live tiles and map link).
- Configuration actions: show the GPSLogger URLs, send a test position,
  forget a tracker.
- Parameters of the Home Assistant GPSLogger setup accepted as is.
- English, French, German and Spanish texts and documentation.

[Unreleased]: https://github.com/gboulvin/Gladys-GPSLogger/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/gboulvin/Gladys-GPSLogger/releases/tag/v1.0.0
