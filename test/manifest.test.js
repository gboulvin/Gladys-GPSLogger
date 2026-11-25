// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { ACTIONS, WEBHOOK_KEY } from '../src/actions.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { SCENE_TRIGGER_KEYS } from '../src/engine.js';
import { RECEIVER_CONTAINER } from '../src/relay.js';
import { RECEIVER_PORT } from '../src/receiver.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { WIDGETS } from '../src/widgets.js';
import { LANGUAGES } from '../src/i18n.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

/** Every multi-language object of the manifest, with its path. */
function multiLanguageTexts(node, path = '$') {
  if (Array.isArray(node)) {
    return node.flatMap((item, i) => multiLanguageTexts(item, `${path}[${i}]`));
  }
  if (node && typeof node === 'object') {
    if (typeof node.en === 'string') {
      return [[path, node]];
    }
    return Object.entries(node).flatMap(([key, value]) =>
      multiLanguageTexts(value, `${path}.${key}`),
    );
  }
  return [];
}

test('every manifest action has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.actions).sort(), Object.keys(ACTIONS).sort());
});

test('every scene_actions key has a handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
});

test('every widgets key has a content handler, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.widgets).sort(), Object.keys(WIDGETS).sort());
});

test('every scene trigger the code fires is declared in scene_triggers, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), [...SCENE_TRIGGER_KEYS].sort());
});

test('the webhook and the receiver sub-container match the code', () => {
  assert.deepEqual(keysOf(manifest.webhooks), [WEBHOOK_KEY]);
  const receiver = manifest.containers.find((c) => c.name === RECEIVER_CONTAINER);
  assert.ok(receiver, 'the receiver sub-container is declared');
  assert.equal(receiver.start, 'manual', 'the integration starts it with its relay secret');
  assert.equal(receiver.env.GPSLOGGER_ROLE, 'receiver');
  assert.equal(receiver.docker_image, manifest.docker_image, 'it runs the integration image');
  assert.equal(receiver.ports[0].container_port, RECEIVER_PORT);
  // The local URL section refers to the port by its name.
  const local = manifest.config_schema.find((f) => f.key === 'local_section');
  assert.match(local.description.en, new RegExp(`\\{\\{port:${receiver.ports[0].name}\\}\\}`));
});

test('both transports are declared: local receiver and Gladys Plus', () => {
  assert.deepEqual([...manifest.transports].sort(), ['cloud', 'local']);
});

test('capability fields require Gladys >= 5.1.0 and categories >= 4.86.0', () => {
  for (const field of ['scene_triggers', 'scene_actions', 'widgets']) {
    assert.ok(manifest[field]?.length > 0, `${field} is declared`);
  }
  assert.ok(isAtLeast(minGladysVersion(), [5, 1, 0]));
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  // keywords / countries need 5.3.0, source "houses" 5.2.0: not used.
  assert.equal(manifest.keywords, undefined);
  assert.ok(allFields.every((f) => f.source === undefined || f.source === 'devices'));
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.type === 'section') {
      assert.equal(field.default, undefined);
      assert.ok(!(field.key in DEFAULT_CONFIG), `section ${field.key} stores no value`);
      continue;
    }
    assert.ok(field.key in DEFAULT_CONFIG, `${field.key} has a default in DEFAULT_CONFIG`);
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `DEFAULT_CONFIG.${field.key}`);
    }
  }
});

test('section links are https', () => {
  for (const field of allFields.filter((f) => f.type === 'section')) {
    for (const link of field.links ?? []) {
      assert.match(link.url, /^https:\/\//);
    }
  }
});

test('dynamic selects declare a source and no static options', () => {
  for (const field of allFields.filter((f) => f.source !== undefined)) {
    assert.equal(field.options, undefined, `field "${field.key}"`);
    assert.equal(field.default, undefined, `field "${field.key}"`);
  }
});

test('every text of the manifest is translated in English, French, German and Spanish', () => {
  const texts = multiLanguageTexts(manifest);
  assert.ok(texts.length > 50);
  for (const [path, text] of texts) {
    for (const lang of LANGUAGES) {
      assert.ok(text[lang]?.trim(), `${path} misses the "${lang}" translation`);
    }
  }
});

test('the user documentation exists in every language', () => {
  for (const lang of LANGUAGES) {
    assert.ok(existsSync(new URL(`../docs/${lang}.md`, import.meta.url)), `docs/${lang}.md`);
  }
});

test('the manifest version is the package version, and the images are tagged with it', () => {
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${lang}: ${text.length}`);
  }
});

test('field placeholders are multi-language objects', () => {
  for (const field of allFields.filter((f) => f.placeholder !== undefined)) {
    assert.equal(typeof field.placeholder, 'object', `field "${field.key}": placeholder`);
  }
});

test('widget labels hold 3 to 30 characters, descriptions at most 100', () => {
  for (const widget of manifest.widgets) {
    for (const text of Object.values(widget.label)) {
      assert.ok(text.length >= 3 && text.length <= 30, `${widget.key}: "${text}"`);
    }
    for (const text of Object.values(widget.description ?? {})) {
      assert.ok(text.length <= 100, `${widget.key}: "${text}"`);
    }
  }
});
