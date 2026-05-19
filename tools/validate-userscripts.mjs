import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(rootDir, '..');
const userscriptsDir = path.join(projectRoot, 'userscripts');
const publicScanIgnoredDirectories = new Set([
  '.cache',
  '.git',
  '.playwright-mcp',
  'artifacts',
  'node_modules',
  'playwright-report',
  'private-local',
  'fixtures',
  'tests',
  'test-results'
]);
const publicScanIgnoredFiles = new Set([
  'AGENTS.md',
  'agents.md',
  'playwright.config.js',
  'run-live-tests.mjs'
]);
const publicTextExtensions = new Set([
  '.csv',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.txt',
  '.yaml',
  '.yml'
]);
const publicTextFileNames = new Set(['.gitignore', 'LICENSE']);
const requiredManifestKeys = [
  'id',
  'name',
  'version',
  'description',
  'targets',
  'domPrefix',
  'storagePrefix',
  'ownedSelectors',
  'configModes',
  'requiresAuth',
  'safeSmokeUrl',
  'homepageUrl',
  'supportUrl',
  'distribution',
  'allowedGrants',
  'allowedConnectHosts',
  'coexistsWith'
];
const secretPatterns = [
  /ghp_[A-Za-z0-9]{36}/,
  /gho_[A-Za-z0-9]{36}/,
  /sk-[A-Za-z0-9]{20,}/,
  /AIza[0-9A-Za-z\-_]{35}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /2PACX-1v[0-9A-Za-z\-_]+/
];

function ensureArray(value) {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function overlap(left, right) {
  return left.some((item) => right.includes(item));
}

async function listDirectories(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

function parseMetadata(scriptText) {
  const match = scriptText.match(/\/\/ ==UserScript==([\s\S]*?)\/\/ ==\/UserScript==/);
  if (!match) {
    throw new Error('No se encontro un bloque de metadata Tampermonkey.');
  }

  const metadata = new Map();
  for (const rawLine of match[1].split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('// @')) continue;

    const [, key, value = ''] = line.match(/^\/\/\s*@([^\s]+)\s*(.*)$/) || [];
    if (!key) continue;

    if (metadata.has(key)) {
      const currentValue = metadata.get(key);
      metadata.set(key, [...ensureArray(currentValue), value.trim()]);
    } else {
      metadata.set(key, value.trim());
    }
  }

  return metadata;
}

function assert(condition, message, errors) {
  if (!condition) errors.push(message);
}

function isSafePublicUpdateUrl(rawUrl, directory) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  return (
    url.protocol === 'https:' &&
    url.hostname === 'raw.githubusercontent.com' &&
    url.username === '' &&
    url.password === '' &&
    url.search === '' &&
    url.hash === '' &&
    url.pathname.endsWith(`/userscripts/${directory}/${directory}.user.js`)
  );
}

async function validateUserscripts() {
  const directories = await listDirectories(userscriptsDir);
  const manifests = [];
  const errors = [];

  for (const directory of directories) {
    const manifestPath = path.join(userscriptsDir, directory, 'manifest.json');
    const scriptPath = path.join(userscriptsDir, directory, `${directory}.user.js`);
    const manifest = await readJson(manifestPath);
    const scriptText = await fs.readFile(scriptPath, 'utf8');
    const metadata = parseMetadata(scriptText);

    manifests.push({ manifest, directory });

    for (const key of requiredManifestKeys) {
      assert(key in manifest, `[${directory}] Falta la clave '${key}' en manifest.json.`, errors);
    }

    assert(manifest.id === directory, `[${directory}] El id del manifest debe coincidir con el nombre de carpeta.`, errors);
    assert(metadata.get('name') === manifest.name, `[${directory}] @name no coincide con manifest.name.`, errors);
    assert(metadata.get('version') === manifest.version, `[${directory}] @version no coincide con manifest.version.`, errors);
    assert(metadata.get('description') === manifest.description, `[${directory}] @description no coincide con manifest.description.`, errors);
    assert(metadata.get('homepageURL') === manifest.homepageUrl, `[${directory}] @homepageURL no coincide con el manifest.`, errors);
    assert(metadata.get('supportURL') === manifest.supportUrl, `[${directory}] @supportURL no coincide con el manifest.`, errors);

    if (manifest.distribution?.mode === 'online-auto-update') {
      assert(manifest.distribution.source === 'github-raw', `[${directory}] distribution.source debe ser 'github-raw'.`, errors);
      assert(manifest.distribution.updateUrl === metadata.get('updateURL'), `[${directory}] @updateURL no coincide con distribution.updateUrl.`, errors);
      assert(manifest.distribution.downloadUrl === metadata.get('downloadURL'), `[${directory}] @downloadURL no coincide con distribution.downloadUrl.`, errors);
      assert(
        isSafePublicUpdateUrl(manifest.distribution.updateUrl, directory),
        `[${directory}] distribution.updateUrl debe ser una URL publica segura de raw.githubusercontent.com sin query, token ni credenciales.`,
        errors
      );
      assert(
        isSafePublicUpdateUrl(manifest.distribution.downloadUrl, directory),
        `[${directory}] distribution.downloadUrl debe ser una URL publica segura de raw.githubusercontent.com sin query, token ni credenciales.`,
        errors
      );
      assert(manifest.requiresAuth === false, `[${directory}] Los scripts con auto-update no deben requerir autenticacion.`, errors);
    } else if (manifest.distribution?.mode === 'manual') {
      assert(metadata.get('downloadURL') === 'none', `[${directory}] @downloadURL debe ser 'none'.`, errors);
      assert(!metadata.has('updateURL'), `[${directory}] @updateURL no esta permitido en distribucion manual.`, errors);
    } else {
      assert(false, `[${directory}] distribution.mode debe ser 'manual' u 'online-auto-update'.`, errors);
    }

    assert(!ensureArray(metadata.get('match')).includes('*://*/*'), `[${directory}] No se permiten @match globales.`, errors);
    assert(!ensureArray(metadata.get('match')).includes('<all_urls>'), `[${directory}] No se permite <all_urls>.`, errors);
    assert(JSON.stringify(ensureArray(metadata.get('match'))) === JSON.stringify(manifest.targets), `[${directory}] Los @match no coinciden con manifest.targets.`, errors);

    const grants = ensureArray(metadata.get('grant'));
    assert(JSON.stringify(grants) === JSON.stringify(manifest.allowedGrants), `[${directory}] Los grants no coinciden con manifest.allowedGrants.`, errors);

    const connects = ensureArray(metadata.get('connect'));
    assert(!connects.includes('*'), `[${directory}] @connect * esta prohibido.`, errors);
    assert(JSON.stringify(connects) === JSON.stringify(manifest.allowedConnectHosts), `[${directory}] Los @connect no coinciden con manifest.allowedConnectHosts.`, errors);
    assert(scriptText.includes(manifest.domPrefix), `[${directory}] El script no usa domPrefix declarado.`, errors);

    if (manifest.configModes.length > 0) {
      assert(scriptText.includes(manifest.storagePrefix), `[${directory}] El script no usa storagePrefix declarado.`, errors);
      assert(scriptText.includes('GM_registerMenuCommand'), `[${directory}] Los scripts configurables deben registrar menu.`, errors);
    }

    if (scriptText.includes('setInterval(')) {
      assert(scriptText.includes('clearInterval('), `[${directory}] Hay setInterval sin clearInterval detectado.`, errors);
    }

    if (scriptText.includes('new MutationObserver(')) {
      assert(scriptText.includes('.disconnect('), `[${directory}] Hay MutationObserver sin disconnect detectado.`, errors);
    }
  }

  for (let index = 0; index < manifests.length; index += 1) {
    const current = manifests[index];
    for (let offset = index + 1; offset < manifests.length; offset += 1) {
      const other = manifests[offset];
      assert(
        current.manifest.domPrefix !== other.manifest.domPrefix,
        `[${current.directory}] y [${other.directory}] comparten el mismo domPrefix.`,
        errors
      );
      assert(
        current.manifest.storagePrefix !== other.manifest.storagePrefix,
        `[${current.directory}] y [${other.directory}] comparten el mismo storagePrefix.`,
        errors
      );

      if (overlap(current.manifest.targets, other.manifest.targets)) {
        assert(
          current.manifest.coexistsWith.includes(other.manifest.id) &&
            other.manifest.coexistsWith.includes(current.manifest.id),
          `[${current.directory}] y [${other.directory}] comparten target y deben declararse mutuamente en coexistsWith.`,
          errors
        );
      }
    }
  }

  return errors;
}

async function gatherFiles(target) {
  const stats = await fs.stat(target);
  if (stats.isFile()) return [target];

  const entries = await fs.readdir(target, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory() && publicScanIgnoredDirectories.has(entry.name)) continue;
    if (entry.isFile() && publicScanIgnoredFiles.has(entry.name)) continue;

    const fullPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await gatherFiles(fullPath)));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

async function scanPublicFiles() {
  const files = await gatherFiles(projectRoot);

  const errors = [];

  for (const filePath of files) {
    const extension = path.extname(filePath);
    const fileName = path.basename(filePath);
    if (!publicTextExtensions.has(extension) && !publicTextFileNames.has(fileName)) continue;

    const relativePath = path.relative(projectRoot, filePath);
    const content = await fs.readFile(filePath, 'utf8');
    if (!relativePath.startsWith('fixtures')) {
      for (const pattern of secretPatterns) {
        if (pattern.test(content)) {
          errors.push(`[${relativePath}] Coincidio con patron sensible: ${pattern}`);
        }
      }

      if (/\b\d{11}\b/.test(content)) {
        errors.push(`[${relativePath}] Se detecto un numero de 11 digitos fuera de fixtures; revisar posible PII.`);
      }
    }
  }

  return errors;
}

const scriptErrors = await validateUserscripts();
const publicFileErrors = await scanPublicFiles();
const errors = [...scriptErrors, ...publicFileErrors];

if (errors.length) {
  console.error('Validacion fallida:\n');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log('Validacion completada sin errores.');
