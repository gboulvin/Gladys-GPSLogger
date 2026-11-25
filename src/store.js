// -----------------------------------------------------------------------------
// Persistent tracker store.
//
// Every phone that ever sent a position is a tracker, kept in
// `/data/trackers.json` (the container rootfs is read-only: /data is the only
// writable volume) so the trackers, their last position and their home /
// battery / lost flags survive a restart — without them, the first position
// after a restart could not tell "arrived home" from "was already home".
// -----------------------------------------------------------------------------

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'store' });

const FILE_NAME = 'trackers.json';
const SAVE_DELAY_MS = 2000;

export class TrackerStore {
  /**
   * @param {string | null} dataDir directory of the file, `null` for an
   *   in-memory store (tests).
   */
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.trackers = new Map();
    this.saveTimer = null;
  }

  load() {
    if (!this.dataDir) {
      return this;
    }
    try {
      const content = JSON.parse(readFileSync(join(this.dataDir, FILE_NAME), 'utf8'));
      for (const tracker of Object.values(content.trackers ?? {})) {
        if (tracker?.id && tracker?.name) {
          this.trackers.set(tracker.id, tracker);
        }
      }
      logger.info(`Loaded ${this.trackers.size} tracker(s)`);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.error('Could not read the tracker store, starting empty', err);
      }
    }
    return this;
  }

  list() {
    return [...this.trackers.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  get(id) {
    return this.trackers.get(id);
  }

  set(tracker) {
    this.trackers.set(tracker.id, tracker);
    this.scheduleSave();
  }

  delete(id) {
    const deleted = this.trackers.delete(id);
    if (deleted) {
      this.scheduleSave();
    }
    return deleted;
  }

  // Positions can arrive every few seconds: coalesce the writes.
  scheduleSave() {
    if (!this.dataDir || this.saveTimer) {
      return;
    }
    this.saveTimer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
    this.saveTimer.unref?.();
  }

  flush() {
    clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (!this.dataDir) {
      return;
    }
    try {
      mkdirSync(this.dataDir, { recursive: true });
      const file = join(this.dataDir, FILE_NAME);
      // Write then rename: a crash mid-write never leaves a truncated file.
      writeFileSync(`${file}.tmp`, JSON.stringify({ trackers: Object.fromEntries(this.trackers) }));
      renameSync(`${file}.tmp`, file);
    } catch (err) {
      logger.error('Could not save the tracker store', err);
    }
  }
}
