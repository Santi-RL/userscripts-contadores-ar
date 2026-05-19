import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(rootDir, '..');
const userscriptsDir = path.join(projectRoot, 'userscripts');
const scriptId = 'arca-login-client-selector';
const domPrefix = 'tm-arca-login-client-selector';
const storagePrefix = 'tm.arca-login-client-selector';
const scriptPath = path.join(userscriptsDir, scriptId, `${scriptId}.user.js`);
const manifestPath = path.join(userscriptsDir, scriptId, 'manifest.json');
const scriptText = await fs.readFile(scriptPath, 'utf8');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
const tests = [];
const sampleCompanyCuit = ['30', '87654321', '0'].join('');
const samplePersonCuit = ['27', '12345678', '9'].join('');

function test(name, run) {
  tests.push({ name, run });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message} Esperado: ${JSON.stringify(expected)}. Actual: ${JSON.stringify(actual)}.`);
  }
}

function assertIncludes(value, expected, message) {
  assert(String(value).includes(expected), `${message} No se encontro ${JSON.stringify(expected)} en ${JSON.stringify(value)}.`);
}

function delay(ms = 0) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

class FakeEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.bubbles = Boolean(options.bubbles);
    this.key = options.key || '';
    this.defaultPrevented = false;
    this.target = null;
    this.currentTarget = null;
  }

  preventDefault() {
    this.defaultPrevented = true;
  }
}

class FakeOption {
  constructor(text, value, defaultSelected = false, selected = false) {
    this.text = String(text);
    this.textContent = String(text);
    this.value = String(value);
    this.defaultSelected = Boolean(defaultSelected);
    this.selected = Boolean(selected);
    this.disabled = false;
    this.parentElement = null;
  }
}

function dataAttributeToProperty(name) {
  return name
    .slice(5)
    .replace(/-([a-z])/g, (_, character) => character.toUpperCase());
}

function classNames(element) {
  return String(element.className || '')
    .split(/\s+/)
    .filter(Boolean);
}

function matchesSelector(element, selector) {
  const trimmedSelector = selector.trim();

  if (trimmedSelector.startsWith('.')) {
    return classNames(element).includes(trimmedSelector.slice(1));
  }

  if (trimmedSelector.startsWith('#')) {
    return element.id === trimmedSelector.slice(1);
  }

  const tagClassMatch = trimmedSelector.match(/^([a-zA-Z][\w-]*)\.([\w-]+)$/);
  if (tagClassMatch) {
    return (
      element.localName === tagClassMatch[1].toLowerCase() &&
      classNames(element).includes(tagClassMatch[2])
    );
  }

  const attributeMatch = trimmedSelector.match(/^(?:([a-zA-Z][\w-]*)\s*)?\[([^=\]]+)="([^"]*)"\]$/);
  if (attributeMatch) {
    const [, tagName, attributeName, expectedValue] = attributeMatch;
    if (tagName && element.localName !== tagName.toLowerCase()) return false;
    return element.getAttribute(attributeName) === expectedValue;
  }

  return element.localName === trimmedSelector.toLowerCase();
}

function collectDescendants(element, selector, matches = []) {
  for (const child of element.children) {
    if (matchesSelector(child, selector)) matches.push(child);
    collectDescendants(child, selector, matches);
  }
  return matches;
}

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.ownerDocument = ownerDocument;
    this.localName = tagName.toLowerCase();
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.attributes = new Map();
    this.dataset = {};
    this.style = {};
    this.listeners = new Map();
    this.className = '';
    this.id = '';
    this.name = '';
    this.type = '';
    this.accept = '';
    this.autocomplete = '';
    this.placeholder = '';
    this.textContent = '';
    this.hidden = false;
    this.disabled = false;
    this.files = null;
    this._value = '';
    this.options = [];
    this.selectedIndex = -1;
  }

  get isConnected() {
    let node = this;
    while (node) {
      if (node === this.ownerDocument.documentElement) return true;
      node = node.parentElement;
    }
    return false;
  }

  get nextSibling() {
    if (!this.parentElement) return null;
    const siblings = this.parentElement.children;
    const index = siblings.indexOf(this);
    return index >= 0 ? siblings[index + 1] || null : null;
  }

  get labels() {
    return [];
  }

  get value() {
    if (this.tagName === 'SELECT') {
      return this.options[this.selectedIndex]?.value || '';
    }
    return this._value;
  }

  set value(nextValue) {
    if (this.tagName === 'SELECT') {
      const index = this.options.findIndex((option) => option.value === String(nextValue));
      this.selectedIndex = index;
      return;
    }
    this._value = String(nextValue ?? '');
  }

  set innerHTML(nextValue) {
    if (nextValue !== '') {
      throw new Error('FakeElement solo soporta innerHTML vacio en tests.');
    }
    for (const child of this.children) {
      child.parentElement = null;
    }
    this.children = [];
    this.options = [];
    this.selectedIndex = -1;
  }

  get innerHTML() {
    return this.children.map((child) => child.textContent).join('');
  }

  appendChild(child) {
    if (child.parentElement) child.remove();
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  insertBefore(child, referenceChild) {
    if (!referenceChild) return this.appendChild(child);

    const referenceIndex = this.children.indexOf(referenceChild);
    if (referenceIndex === -1) return this.appendChild(child);

    if (child.parentElement) child.remove();
    child.parentElement = this;
    this.children.splice(referenceIndex, 0, child);
    return child;
  }

  compareDocumentPosition(other) {
    const orderedElements = [];
    const collect = (element) => {
      orderedElements.push(element);
      for (const child of element.children) collect(child);
    };
    collect(this.ownerDocument.documentElement);

    const ownIndex = orderedElements.indexOf(this);
    const otherIndex = orderedElements.indexOf(other);
    if (ownIndex === -1 || otherIndex === -1 || ownIndex === otherIndex) return 0;
    return otherIndex > ownIndex ? 4 : 2;
  }

  add(option) {
    assert(this.tagName === 'SELECT', 'add() solo esta soportado en select.');
    option.parentElement = this;
    this.options.push(option);
    if (this.selectedIndex === -1) this.selectedIndex = this.options.length - 1;
    return option;
  }

  remove() {
    if (!this.parentElement) return;
    const siblings = this.parentElement.children;
    const index = siblings.indexOf(this);
    if (index >= 0) siblings.splice(index, 1);
    this.parentElement = null;
  }

  setAttribute(name, value) {
    const stringValue = String(value);
    this.attributes.set(name, stringValue);
    if (name === 'id') this.id = stringValue;
    if (name === 'name') this.name = stringValue;
    if (name === 'class') this.className = stringValue;
    if (name === 'type') this.type = stringValue;
    if (name === 'placeholder') this.placeholder = stringValue;
    if (name === 'autocomplete') this.autocomplete = stringValue;
    if (name.startsWith('data-')) this.dataset[dataAttributeToProperty(name)] = stringValue;
  }

  getAttribute(name) {
    if (name === 'id') return this.id || null;
    if (name === 'name') return this.name || null;
    if (name === 'class') return this.className || null;
    if (name === 'type') return this.type || null;
    if (name === 'placeholder') return this.placeholder || null;
    if (name === 'autocomplete') return this.autocomplete || null;
    if (name.startsWith('data-')) return this.dataset[dataAttributeToProperty(name)] || null;
    return this.attributes.get(name) || null;
  }

  addEventListener(type, handler, options = {}) {
    const listeners = this.listeners.get(type) || [];
    listeners.push({ handler, once: Boolean(options.once) });
    this.listeners.set(type, listeners);
  }

  dispatchEvent(event) {
    event.target = event.target || this;
    event.currentTarget = this;
    const listeners = [...(this.listeners.get(event.type) || [])];
    for (const listener of listeners) {
      listener.handler.call(this, event);
      if (listener.once) {
        const current = this.listeners.get(event.type) || [];
        this.listeners.set(
          event.type,
          current.filter((candidate) => candidate !== listener)
        );
      }
    }
    return !event.defaultPrevented;
  }

  click() {
    this.dispatchEvent(new FakeEvent('click', { bubbles: true }));
  }

  focus() {
    this.ownerDocument.activeElement = this;
  }

  querySelector(selector) {
    return collectDescendants(this, selector)[0] || null;
  }

  querySelectorAll(selector) {
    return collectDescendants(this, selector);
  }
}

class FakeDocument {
  constructor() {
    this.listeners = new Map();
    this.readyState = 'complete';
    this.activeElement = null;
    this.documentElement = new FakeElement('html', this);
    this.head = new FakeElement('head', this);
    this.body = new FakeElement('body', this);
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
  }

  createElement(tagName) {
    return new FakeElement(tagName, this);
  }

  addEventListener(type, handler, options = {}) {
    const listeners = this.listeners.get(type) || [];
    listeners.push({ handler, once: Boolean(options.once) });
    this.listeners.set(type, listeners);
  }

  dispatchEvent(event) {
    const listeners = [...(this.listeners.get(event.type) || [])];
    for (const listener of listeners) {
      listener.handler.call(this, event);
    }
  }

  getElementById(id) {
    return collectDescendants(this.documentElement, `#${id}`)[0] || null;
  }

  querySelector(selector) {
    if (matchesSelector(this.documentElement, selector)) return this.documentElement;
    return collectDescendants(this.documentElement, selector)[0] || null;
  }

  querySelectorAll(selector) {
    const matches = matchesSelector(this.documentElement, selector) ? [this.documentElement] : [];
    return collectDescendants(this.documentElement, selector, matches);
  }
}

class FakeWindow {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, handler, options = {}) {
    const listeners = this.listeners.get(type) || [];
    listeners.push({ handler, once: Boolean(options.once) });
    this.listeners.set(type, listeners);
  }

  dispatchEvent(event) {
    event.target = event.target || this;
    const listeners = [...(this.listeners.get(event.type) || [])];
    for (const listener of listeners) {
      listener.handler.call(this, event);
      if (listener.once) {
        const current = this.listeners.get(event.type) || [];
        this.listeners.set(
          event.type,
          current.filter((candidate) => candidate !== listener)
        );
      }
    }
  }
}

function createHarness(options = {}) {
  const document = new FakeDocument();
  const window = new FakeWindow();
  const storage = new Map(Object.entries(options.storage || {}));
  const menuCommands = new Map();
  const requests = [];
  const alerts = [];
  const warnings = [];
  const remoteResponses = [...(options.remoteResponses || [])];
  const promptResponses = [...(options.promptResponses || [])];
  const loginInput = document.createElement('input');
  loginInput.id = 'F1:username';
  loginInput.name = 'F1:username';
  loginInput.type = 'text';
  document.body.appendChild(loginInput);

  const nextButton = document.createElement('button');
  nextButton.textContent = 'Siguiente';
  document.body.appendChild(nextButton);

  const helpLink = document.createElement('a');
  helpLink.textContent = 'Ayuda';
  document.body.appendChild(helpLink);

  const footer = document.createElement('div');
  footer.textContent = 'Pie';
  document.body.appendChild(footer);

  const context = {
    console: {
      log() {},
      warn(...args) {
        warnings.push(args);
      },
      error: console.error
    },
    document,
    window,
    URL,
    URLSearchParams,
    Event: FakeEvent,
    Option: FakeOption,
    setTimeout,
    clearTimeout,
    prompt() {
      return promptResponses.length ? promptResponses.shift() : null;
    },
    confirm() {
      return options.confirmResponse ?? true;
    },
    alert(message) {
      alerts.push(String(message));
    },
    GM_getValue(key, defaultValue) {
      return storage.has(key) ? storage.get(key) : defaultValue;
    },
    GM_setValue(key, value) {
      storage.set(key, value);
    },
    GM_deleteValue(key) {
      storage.delete(key);
    },
    GM_registerMenuCommand(name, handler) {
      menuCommands.set(name, handler);
    },
    GM_xmlhttpRequest(request) {
      requests.push(request);
      const response = remoteResponses.shift() || { status: 200, responseText: '' };
      setTimeout(() => {
        if (response.timeout) {
          request.ontimeout?.();
        } else if (response.error) {
          request.onerror?.();
        } else {
          request.onload?.({
            status: response.status ?? 200,
            responseText: response.responseText ?? ''
          });
        }
      }, 0);
      return {
        abort() {}
      };
    }
  };

  context.window.window = window;
  context.window.document = document;
  context.window.Event = FakeEvent;
  context.window.Option = FakeOption;

  vm.runInNewContext(scriptText, context, { filename: scriptPath });

  return {
    alerts,
    document,
    footer,
    helpLink,
    loginInput,
    menuCommands,
    nextButton,
    requests,
    storage,
    warnings,
    window,
    buttonByText(text) {
      return document.querySelectorAll('button').find((button) => button.textContent === text);
    },
    async flush() {
      await delay(0);
      await delay(0);
    }
  };
}

function storageKey(key) {
  return `${storagePrefix}.${key}`;
}

test('metadata y manifest mantienen la politica de auto-update publico', () => {
  assertParseableJavaScript(scriptText, scriptId);
  assertMetadataShape(scriptText, scriptId);
  assertLifecycleShape(scriptText, scriptId);
  assertOwnedSelectorsShape(manifest, scriptId);
  assertIncludes(scriptText, manifest.distribution.updateUrl, 'El userscript debe declarar updateURL publico.');
  assertIncludes(scriptText, manifest.distribution.downloadUrl, 'El userscript debe declarar downloadURL publico.');
  assert(!scriptText.includes('@require'), 'El userscript no debe depender de require remoto.');
  assertEqual(manifest.distribution.mode, 'online-auto-update', 'El manifest debe declarar auto-update.');
  assertEqual(manifest.distribution.source, 'github-raw', 'El manifest debe declarar GitHub raw como fuente.');
});

test('inicializa UI, registra menus y destruye nodos en pagehide', () => {
  const harness = createHarness();
  const root = harness.document.querySelector(`.${domPrefix}-root`);
  const selectorRoot = harness.document.querySelector(`.${domPrefix}-selector-root`);
  const controlsBody = harness.document.querySelector(`.${domPrefix}-controls`);
  const style = harness.document.querySelector(`style.${domPrefix}-style`);
  const searchInput = harness.document.querySelector(`.${domPrefix}-input`);
  const select = harness.document.querySelector(`.${domPrefix}-select`);
  const title = harness.document.querySelector(`.${domPrefix}-title`);

  assert(root, 'Debe inyectar el contenedor de controles.');
  assert(selectorRoot, 'Debe inyectar el contenedor de busqueda y selector.');
  assert(controlsBody, 'Debe inyectar el cuerpo colapsable de controles.');
  assert(style, 'Debe inyectar estilos propios.');
  assertEqual(root.dataset.tmScript, scriptId, 'El contenedor debe declarar data-tm-script.');
  assertEqual(selectorRoot.dataset.tmScript, scriptId, 'El contenedor de busqueda debe declarar data-tm-script.');
  assertEqual(harness.menuCommands.size, 4, 'Debe registrar los cuatro comandos de menu esperados.');
  assertEqual(controlsBody.hidden, false, 'Sin datos cargados, el bloque de controles debe iniciar desplegado.');
  assertEqual(root.dataset.collapsed, 'false', 'Sin datos cargados, el contenedor no debe estar colapsado.');
  assertEqual(title.getAttribute('aria-expanded'), 'true', 'El titulo debe anunciar controles desplegados.');
  assertEqual(searchInput.parentElement, selectorRoot, 'La busqueda debe quedar fuera del bloque de botones.');
  assertEqual(select.parentElement, selectorRoot, 'El selector debe quedar fuera del bloque de botones.');
  assertEqual(selectorRoot.parentElement, harness.document.body, 'El contenedor de busqueda debe insertarse en el bloque principal.');
  assertEqual(
    harness.document.body.children.indexOf(selectorRoot),
    harness.document.body.children.indexOf(harness.loginInput) + 1,
    'La busqueda debe quedar debajo del input de CUIT.'
  );
  assertEqual(
    harness.document.body.children.indexOf(harness.nextButton),
    harness.document.body.children.indexOf(selectorRoot) + 1,
    'La busqueda debe quedar arriba del boton Siguiente.'
  );
  assertEqual(root.parentElement, harness.document.body, 'El contenedor de botones debe insertarse en el bloque principal cuando existe Ayuda.');
  assertEqual(
    harness.document.body.children.indexOf(root),
    harness.document.body.children.indexOf(harness.helpLink) + 1,
    'El contenedor de botones debe quedar debajo de Ayuda.'
  );
  assertEqual(
    harness.document.body.children.indexOf(harness.footer),
    harness.document.body.children.indexOf(root) + 1,
    'El contenedor debe respetar el contenido posterior a Ayuda.'
  );

  harness.window.dispatchEvent(new FakeEvent('pagehide'));
  assert(!root.parentElement, 'pagehide debe remover el contenedor de controles.');
  assert(!selectorRoot.parentElement, 'pagehide debe remover el contenedor de busqueda y selector.');
  assert(!style.parentElement, 'pagehide debe remover los estilos inyectados.');
});

test('colapsa controles cuando ya hay datos cargados y permite desplegarlos desde el titulo', () => {
  const harness = createHarness({
    storage: {
      [storageKey('config')]: { sourceMode: 'file', sourceUrl: '' },
      [storageKey('dataset')]: {
        sourceMode: 'file',
        sourceUrl: '',
        loadedAt: Date.now(),
        fileName: 'clientes.csv',
        entries: [
          {
            name: 'Empresa SA',
            cuit: sampleCompanyCuit,
            searchKey: `empresa sa ${sampleCompanyCuit}`
          }
        ]
      }
    }
  });
  const root = harness.document.querySelector(`.${domPrefix}-root`);
  const selectorRoot = harness.document.querySelector(`.${domPrefix}-selector-root`);
  const controlsBody = harness.document.querySelector(`.${domPrefix}-controls`);
  const title = harness.document.querySelector(`.${domPrefix}-title`);

  assertEqual(controlsBody.hidden, true, 'Con datos cargados, el bloque de controles debe iniciar colapsado.');
  assertEqual(root.dataset.collapsed, 'true', 'Con datos cargados, el contenedor debe marcarse como colapsado.');
  assertEqual(title.getAttribute('aria-expanded'), 'false', 'El titulo debe anunciar controles colapsados.');
  assertEqual(selectorRoot.hidden, false, 'La busqueda y selector deben mantenerse visibles aunque los controles colapsen.');

  title.click();
  assertEqual(controlsBody.hidden, false, 'Tocar el titulo debe desplegar los controles.');
  assertEqual(title.getAttribute('aria-expanded'), 'true', 'El titulo debe anunciar controles desplegados.');

  title.click();
  assertEqual(controlsBody.hidden, true, 'Tocar el titulo otra vez debe colapsar los controles.');
});

test('importa CSV local, filtra por nombre y completa CUIT', async () => {
  const harness = createHarness();
  const events = [];
  harness.loginInput.addEventListener('input', () => events.push('input'));
  harness.loginInput.addEventListener('change', () => events.push('change'));

  harness.buttonByText('Importar CSV').click();
  const fileInput = harness.document.querySelector('input[type="file"]');
  assert(fileInput, 'El boton Importar CSV debe crear un input file temporal.');
  fileInput.files = [
    {
      name: 'clientes.csv',
      async text() {
        return 'Nombre;Apellido;CUIT\nJose;Alvarez;20-12345678-3\n"Empresa, SA";;30-87654321-0\n';
      }
    }
  ];
  fileInput.dispatchEvent(new FakeEvent('change'));
  await harness.flush();

  const select = harness.document.querySelector(`.${domPrefix}-select`);
  assertEqual(select.options.length, 3, 'El selector debe tener placeholder y dos clientes.');
  assertEqual(harness.storage.get(storageKey('config')).sourceMode, 'file', 'La importacion debe dejar sourceMode=file.');
  assertEqual(harness.storage.get(storageKey('dataset')).entries.length, 2, 'La importacion debe persistir dos entradas.');

  const searchInput = harness.document.querySelector(`.${domPrefix}-input`);
  searchInput.value = 'empresa';
  searchInput.dispatchEvent(new FakeEvent('input'));
  await delay(150);

  assertEqual(harness.loginInput.value, sampleCompanyCuit, 'La busqueda debe autocompletar el CUIT coincidente.');
  assertEqual(harness.storage.get(storageKey('selectedCuit')), sampleCompanyCuit, 'La seleccion debe persistir el ultimo CUIT.');
  assert(events.includes('input') && events.includes('change'), 'Completar CUIT debe disparar eventos input y change.');
});

test('busqueda sin coincidencias limpia CUIT, storage y eventos de pagina', async () => {
  const harness = createHarness({
    storage: {
      [storageKey('config')]: { sourceMode: 'file', sourceUrl: '' },
      [storageKey('selectedCuit')]: sampleCompanyCuit,
      [storageKey('dataset')]: {
        sourceMode: 'file',
        sourceUrl: '',
        entries: [
          {
            name: 'Empresa SA',
            cuit: sampleCompanyCuit,
            searchKey: `empresa sa ${sampleCompanyCuit}`
          }
        ]
      }
    }
  });
  const events = [];
  harness.loginInput.addEventListener('input', () => events.push('input'));
  harness.loginInput.addEventListener('change', () => events.push('change'));

  const searchInput = harness.document.querySelector(`.${domPrefix}-input`);
  searchInput.value = 'sin coincidencias';
  searchInput.dispatchEvent(new FakeEvent('input'));
  await delay(150);

  assertEqual(harness.loginInput.value, '', 'Sin coincidencias debe limpiar el input original.');
  assert(!harness.storage.has(storageKey('selectedCuit')), 'Sin coincidencias debe borrar selectedCuit.');
  assert(events.includes('input') && events.includes('change'), 'Limpiar CUIT debe notificar a la pagina.');
});

test('normaliza Google Sheets edit URL y carga CSV remoto anonimo', async () => {
  const harness = createHarness({
    remoteResponses: [
      {
        status: 200,
        responseText: 'Nombre,Apellido,CUIT\nAna,Gomez,27-12345678-9\n'
      }
    ]
  });

  harness.buttonByText('Google Sheets').click();
  const urlInput = harness.document.querySelector(`.${domPrefix}-url`);
  urlInput.value = 'https://docs.google.com/spreadsheets/d/sheetABC123/edit#gid=456';
  harness.buttonByText('Guardar').click();
  await harness.flush();

  assertEqual(harness.requests.length, 1, 'Guardar Google Sheets debe disparar una carga remota.');
  const request = harness.requests[0];
  const requestUrl = new URL(request.url);
  assertEqual(request.method, 'GET', 'La carga remota debe usar GET.');
  assertEqual(request.anonymous, true, 'La carga remota debe ser anonima.');
  assertEqual(requestUrl.origin, 'https://docs.google.com', 'La URL normalizada debe quedar en docs.google.com.');
  assertEqual(requestUrl.pathname, '/spreadsheets/d/sheetABC123/export', 'La URL edit debe normalizarse a export CSV.');
  assertEqual(requestUrl.searchParams.get('format'), 'csv', 'La URL normalizada debe pedir CSV.');
  assertEqual(requestUrl.searchParams.get('gid'), '456', 'La URL normalizada debe conservar gid.');
  assertEqual(harness.storage.get(storageKey('dataset')).entries[0].cuit, samplePersonCuit, 'El CSV remoto debe persistirse normalizado.');
});

test('rechaza origenes remotos no HTTPS o fuera de hosts permitidos', async () => {
  const harness = createHarness();

  harness.buttonByText('Google Sheets').click();
  const urlInput = harness.document.querySelector(`.${domPrefix}-url`);
  urlInput.value = 'http://evil.example/clientes.csv';
  harness.buttonByText('Guardar').click();
  await harness.flush();

  const status = harness.document.querySelector(`.${domPrefix}-status`);
  assertEqual(harness.requests.length, 0, 'Una URL invalida no debe disparar GM_xmlhttpRequest.');
  assertEqual(status.dataset.error, 'true', 'Una URL invalida debe mostrarse como error.');
});

function assertParseableJavaScript(currentScriptText, directory) {
  try {
    new Function(currentScriptText);
  } catch (error) {
    throw new Error(`[${directory}] El userscript no parsea como JavaScript valido: ${error.message}`);
  }
}

function assertMetadataShape(currentScriptText, directory) {
  const metadataBlocks = currentScriptText.match(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/g) || [];
  assertEqual(metadataBlocks.length, 1, `[${directory}] Debe existir exactamente un bloque de metadata Tampermonkey.`);
  assert(currentScriptText.trimStart().startsWith('// ==UserScript=='), `[${directory}] El bloque de metadata debe estar al inicio del archivo.`);
}

function assertLifecycleShape(currentScriptText, directory) {
  assert(/\bfunction\s+init\s*\(/.test(currentScriptText), `[${directory}] Falta una funcion init() explicita.`);
  assert(/\bfunction\s+destroy\s*\(/.test(currentScriptText), `[${directory}] Falta una funcion destroy() explicita.`);
  assert(/pagehide[\s\S]*destroy\s*\(/.test(currentScriptText), `[${directory}] destroy() debe registrarse para pagehide.`);
}

function assertOwnedSelectorsShape(currentManifest, directory) {
  assert(Array.isArray(currentManifest.ownedSelectors), `[${directory}] manifest.ownedSelectors debe ser un array.`);
  assert(currentManifest.ownedSelectors.length > 0, `[${directory}] manifest.ownedSelectors no debe estar vacio.`);
  assert(
    currentManifest.ownedSelectors.includes(`[data-tm-script="${currentManifest.id}"]`),
    `[${directory}] manifest.ownedSelectors debe declarar el contenedor data-tm-script del script.`
  );
  assert(
    currentManifest.ownedSelectors.some((selector) => selector === `.${currentManifest.domPrefix}-root`),
    `[${directory}] manifest.ownedSelectors debe declarar la clase root principal.`
  );
}

const failures = [];

for (const currentTest of tests) {
  try {
    await currentTest.run();
    console.log(`ok - ${currentTest.name}`);
  } catch (error) {
    failures.push({ name: currentTest.name, error });
    console.error(`not ok - ${currentTest.name}`);
    console.error(`  ${error.message}`);
  }
}

if (failures.length) {
  console.error(`\n${failures.length} test(s) fallaron.`);
  process.exit(1);
}

console.log(`\n${tests.length} tests completados sin errores.`);
