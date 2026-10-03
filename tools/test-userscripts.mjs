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
    this.persisted = Boolean(options.persisted);
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

  getClientRects() {
    for (let node = this; node; node = node.parentElement) {
      if (node.hidden || node.style.display === 'none') return [];
    }
    return this.isConnected && this.type !== 'hidden' ? [{}] : [];
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

  removeEventListener(type, handler) {
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(
      type,
      listeners.filter((listener) => listener.handler !== handler)
    );
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

  removeEventListener(type, handler) {
    const listeners = this.listeners.get(type) || [];
    this.listeners.set(
      type,
      listeners.filter((listener) => listener.handler !== handler)
    );
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
  const storageReads = new Map();
  const fileReaders = [];
  const alerts = [];
  const warnings = [];
  const remoteResponses = [...(options.remoteResponses || [])];
  const promptResponses = [...(options.promptResponses || [])];
  const loginInput = document.createElement('input');
  const panel = options.form ? document.createElement('div') : document.body;
  const form = options.form ? document.createElement('form') : document.body;
  if (options.form) {
    form.id = 'F1';
    panel.appendChild(form);
    document.body.appendChild(panel);
  }
  loginInput.id = 'F1:username';
  loginInput.name = 'F1:username';
  loginInput.type = 'text';
  form.appendChild(loginInput);

  const nextButton = document.createElement('button');
  nextButton.textContent = 'Siguiente';
  form.appendChild(nextButton);

  const helpLink = document.createElement('a');
  helpLink.textContent = 'Ayuda';
  form.appendChild(helpLink);

  const footer = document.createElement('div');
  footer.textContent = 'Pie';
  form.appendChild(footer);

  const observers = [];
  window.getComputedStyle = (element) => ({
    display: element.style.display || 'block',
    visibility: element.style.visibility || 'visible'
  });
  options.beforeScript?.({ document, loginInput, form, panel });

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
    MutationObserver: class {
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe(target, settings) { this.target = target; this.settings = settings; this.active = true; }
      disconnect() { this.active = false; }
    },
    Date: options.now === undefined ? Date : class extends Date {
      static now() { return options.now; }
    },
    FileReader: class {
      constructor() {
        this.result = null;
        this.aborted = false;
        fileReaders.push(this);
      }
      readAsText(file) {
        Promise.resolve(file.text()).then((text) => {
          if (this.aborted) return;
          this.result = text;
          this.onload?.();
        }, () => {
          if (!this.aborted) this.onerror?.();
        });
      }
      abort() {
        this.aborted = true;
        this.onabort?.();
      }
    },
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
      storageReads.set(key, (storageReads.get(key) || 0) + 1);
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
      const respond = () => {
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
      };
      const timer = options.manualRequests ? null : setTimeout(respond, response.delayMs || 0);
      return {
        abort() {
          request.aborted = true;
          if (timer !== null) clearTimeout(timer);
          request.onabort?.();
        }
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
    storageReads,
    fileReaders,
    warnings,
    window,
    form,
    panel,
    observers,
    notifyStepChange(target = form, type = 'attributes', nodes = []) {
      for (const observer of observers.filter((item) => item.active)) {
        observer.callback([{ target, type, addedNodes: nodes, removedNodes: [] }]);
      }
    },
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

test('importa CSV local con columnas extra, filtra por nombre y completa CUIT', async () => {
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
        return 'Record ID;Nombre;Apellido;CUIT\n901;Jose;Alvarez;20-12345678-3\n902;"Empresa, SA";;30-87654321-0\n';
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

test('muestra error explicito cuando el CSV no tiene encabezados reconocidos', async () => {
  const harness = createHarness({
    remoteResponses: [
      {
        status: 200,
        responseText: `Sabrina Jeanette,Acosta,${samplePersonCuit}\nEmpresa,SA,${sampleCompanyCuit}\n`
      }
    ]
  });

  harness.buttonByText('Google Sheets').click();
  const urlInput = harness.document.querySelector(`.${domPrefix}-url`);
  urlInput.value = 'https://docs.google.com/spreadsheets/d/sheetABC123/edit#gid=456';
  harness.buttonByText('Guardar').click();
  await harness.flush();

  const status = harness.document.querySelector(`.${domPrefix}-status`);
  assertEqual(status.dataset.error, 'true', 'Un CSV sin encabezados debe mostrarse como error.');
  assertIncludes(
    status.textContent,
    'No se detectaron los encabezados necesarios Nombre, Apellido y CUIT en la fila 1',
    'El error debe explicar que faltan encabezados reconocidos.'
  );
  assertIncludes(
    status.textContent,
    'Nombre, Apellido y CUIT',
    'El error debe mencionar los encabezados esperados.'
  );
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

const refreshTtl = 24 * 60 * 60 * 1000;
const syntheticSheetUrl = 'https://docs.google.com/spreadsheets/d/testSheet/export?format=csv&gid=0';
const syntheticEntry = { name: 'Cliente de prueba', cuit: sampleCompanyCuit, searchKey: `cliente de prueba ${sampleCompanyCuit}` };
const syntheticCsv = `Nombre,CUIT\nCliente nuevo,${samplePersonCuit}\n`;

function remoteStorage(loadedAt) {
  return {
    [storageKey('config')]: { sourceMode: 'url', sourceUrl: syntheticSheetUrl },
    [storageKey('dataset')]: { sourceMode: 'url', sourceUrl: syntheticSheetUrl, loadedAt, entries: [syntheticEntry] },
    [storageKey('selectedCuit')]: sampleCompanyCuit
  };
}

test('usa la caché reciente sin red y conserva el último cliente seleccionado', async () => {
  const now = 2_000_000_000_000;
  const harness = createHarness({ now, storage: remoteStorage(now - refreshTtl + 1) });
  await harness.flush();
  assertEqual(harness.requests.length, 0, 'Una caché de menos de 24 horas no debe descargarse de nuevo.');
  assertEqual(harness.loginInput.value, sampleCompanyCuit, 'Debe restaurar el cliente guardado desde la primera carga.');
  assertEqual(harness.storage.get(storageKey('selectedCuit')), sampleCompanyCuit, 'El inicio no debe borrar la selección.');
  assertIncludes(harness.document.querySelector(`.${domPrefix}-hint`).textContent, 'Última actualización:', 'Debe mostrar la fecha de sincronización.');
});

test('actualiza a las 24 horas y permite usar la lista anterior mientras descarga', async () => {
  const now = 2_000_000_000_000;
  const harness = createHarness({ now, storage: remoteStorage(now - refreshTtl), manualRequests: true });
  assertEqual(harness.requests.length, 1, 'Al cumplir 24 horas debe actualizarse.');
  assertEqual(harness.loginInput.value, sampleCompanyCuit, 'La caché debe estar disponible sin esperar la respuesta.');
  harness.requests[0].onload({ status: 200, responseText: syntheticCsv });
  await harness.flush();
  assertEqual(harness.storage.get(storageKey('dataset')).loadedAt, now, 'Debe guardar la fecha de la descarga correcta.');
  assertEqual(harness.storage.get(storageKey('dataset')).entries[0].cuit, samplePersonCuit, 'Debe incorporar el cliente nuevo.');
});

test('Recargar fuerza una descarga aunque la caché siga vigente', async () => {
  const now = 2_000_000_000_000;
  const harness = createHarness({ now, storage: remoteStorage(now), remoteResponses: [{ responseText: syntheticCsv }] });
  harness.buttonByText('Recargar').click();
  await harness.flush();
  assertEqual(harness.requests.length, 1, 'Recargar debe ignorar el TTL.');
  assertEqual(harness.storage.get(storageKey('dataset')).entries[0].cuit, samplePersonCuit, 'Recargar debe guardar los datos nuevos.');
});

test('rechaza timestamps futuros o ausentes como caché vigente y conserva la lista ante errores', async () => {
  const now = 2_000_000_000_000;
  for (const loadedAt of [undefined, now + 1]) {
    const harness = createHarness({ now, storage: remoteStorage(loadedAt), remoteResponses: [{ error: true }] });
    await harness.flush();
    assertEqual(harness.requests.length, 1, 'Una fecha inválida debe forzar la actualización.');
    assertEqual(harness.loginInput.value, sampleCompanyCuit, 'Una caída de Google no debe eliminar la lista guardada.');
    assertIncludes(harness.document.querySelector(`.${domPrefix}-status`).textContent, 'Se usó la lista guardada', 'Debe informar el uso de datos anteriores.');
    assertEqual(harness.storage.get(storageKey('dataset')).loadedAt, loadedAt, 'Un fallo no debe renovar la fecha de carga.');
  }
});

test('borrar datos aborta la descarga y descarta respuestas tardías', async () => {
  const harness = createHarness({ storage: remoteStorage(0), manualRequests: true });
  const oldRequest = harness.requests[0];
  harness.buttonByText('Borrar datos').click();
  assertEqual(oldRequest.aborted, true, 'Borrar debe abortar la solicitud activa.');
  oldRequest.onload({ status: 200, responseText: syntheticCsv });
  await harness.flush();
  assert(!harness.storage.has(storageKey('dataset')), 'Una respuesta tardía no debe recuperar los datos borrados.');
  assert(!harness.storage.has(storageKey('config')), 'La configuración debe permanecer borrada.');
});

test('importar CSV invalida la solicitud remota anterior', async () => {
  const harness = createHarness({ storage: remoteStorage(0), manualRequests: true });
  const oldRequest = harness.requests[0];
  harness.buttonByText('Importar CSV').click();
  const input = harness.document.querySelector('input[type="file"]');
  input.files = [{ name: 'clientes-sinteticos.csv', async text() { return syntheticCsv; } }];
  input.dispatchEvent(new FakeEvent('change'));
  await harness.flush();
  oldRequest.onload({ status: 200, responseText: `Nombre,CUIT\nAntiguo,${sampleCompanyCuit}\n` });
  await harness.flush();
  assertEqual(oldRequest.aborted, true, 'Importar debe abortar la descarga previa.');
  assertEqual(harness.storage.get(storageKey('config')).sourceMode, 'file', 'Debe conservar el origen local.');
  assertEqual(harness.storage.get(storageKey('dataset')).sourceMode, 'file', 'El dataset debe corresponder al CSV importado.');
  assertEqual(harness.storage.get(storageKey('dataset')).entries[0].cuit, samplePersonCuit, 'La respuesta remota no debe sobrescribir el archivo.');
});

test('borrar mientras se lee un archivo impide guardar su contenido después', async () => {
  const harness = createHarness();
  let finishRead;
  harness.buttonByText('Importar CSV').click();
  const input = harness.document.querySelector('input[type="file"]');
  input.files = [{ name: 'lento.csv', text() { return new Promise((resolve) => { finishRead = resolve; }); } }];
  input.dispatchEvent(new FakeEvent('change'));
  harness.buttonByText('Borrar datos').click();
  assertEqual(harness.fileReaders[0].aborted, true, 'Debe detener la lectura pendiente del archivo.');
  finishRead(syntheticCsv);
  await harness.flush();
  assert(!harness.storage.has(storageKey('dataset')), 'La lectura pendiente no debe deshacer el borrado.');
});

test('cambiar de fuente descarta el error anterior sin vaciar la carga nueva', async () => {
  const harness = createHarness({ storage: remoteStorage(0), manualRequests: true });
  const oldRequest = harness.requests[0];
  harness.buttonByText('Google Sheets').click();
  harness.document.querySelector(`.${domPrefix}-url`).value = syntheticSheetUrl.replace('testSheet', 'otherTestSheet');
  harness.buttonByText('Guardar').click();
  harness.requests[1].onload({ status: 200, responseText: syntheticCsv });
  await harness.flush();
  oldRequest.onerror();
  await harness.flush();
  assertEqual(harness.document.querySelector(`.${domPrefix}-select`).options.length, 2, 'El error antiguo no debe vaciar la lista nueva.');
  assertEqual(harness.document.querySelector(`.${domPrefix}-status`).dataset.error, 'false', 'El error antiguo no debe reemplazar el estado correcto.');
});

test('pagehide cancela solicitudes y pageshow restaura la UI sin duplicarla', async () => {
  const harness = createHarness({ storage: remoteStorage(0), manualRequests: true });
  const oldRequest = harness.requests[0];
  harness.window.dispatchEvent(new FakeEvent('pagehide', { persisted: true }));
  assertEqual(oldRequest.aborted, true, 'Salir debe abortar la solicitud pendiente.');
  oldRequest.onload({ status: 200, responseText: syntheticCsv });
  await harness.flush();
  assertEqual(harness.storage.get(storageKey('dataset')).loadedAt, 0, 'Una respuesta tras salir no debe cambiar el storage.');
  harness.window.dispatchEvent(new FakeEvent('pageshow', { persisted: true }));
  harness.window.dispatchEvent(new FakeEvent('pageshow', { persisted: true }));
  assertEqual(harness.document.querySelectorAll(`.${domPrefix}-root`).length, 1, 'Al volver debe haber una sola UI.');
  assertEqual(harness.requests.length, 2, 'La restauración debe reintentar la carga una sola vez.');
  harness.window.dispatchEvent(new FakeEvent('pagehide'));
  await harness.flush();
});

test('limita las opciones a 100, conserva una selección lejana y encuentra cualquier cliente', async () => {
  const entries = Array.from({ length: 5000 }, (_, i) => ({ name: `Cliente ${i}`, cuit: String(20 * 1e9 + i), searchKey: `cliente ${i}` }));
  const selected = entries[4999];
  const harness = createHarness({ storage: {
    [storageKey('config')]: { sourceMode: 'file', sourceUrl: '' },
    [storageKey('dataset')]: { sourceMode: 'file', entries },
    [storageKey('selectedCuit')]: selected.cuit
  } });
  const select = harness.document.querySelector(`.${domPrefix}-select`);
  assertEqual(select.options.length, 101, 'Debe crear 100 opciones y el placeholder.');
  assertEqual(harness.loginInput.value, selected.cuit, 'Debe conservar la selección aunque no esté entre los primeros 100.');
  assertIncludes(harness.document.querySelector(`.${domPrefix}-count`).textContent, '100 de 5000', 'Debe informar que hay más coincidencias.');
  const search = harness.document.querySelector(`.${domPrefix}-input`);
  search.value = 'Cliente 4998';
  search.dispatchEvent(new FakeEvent('input'));
  await delay(150);
  assertEqual(harness.loginInput.value, entries[4998].cuit, 'La búsqueda debe encontrar clientes fuera del límite inicial.');
  assertEqual(harness.storageReads.get(storageKey('dataset')), 1, 'Buscar no debe releer el dataset completo desde storage.');
});

test('cancelar el selector de archivo elimina su nodo temporal', () => {
  const harness = createHarness();
  harness.buttonByText('Importar CSV').click();
  harness.document.querySelector('input[type="file"]').dispatchEvent(new FakeEvent('cancel'));
  assert(!harness.document.querySelector('input[type="file"]'), 'Cancelar debe limpiar el selector temporal.');
});

test('la respuesta remota respeta un CUIT escrito manualmente durante la descarga', async () => {
  for (const failed of [false, true]) {
    const harness = createHarness({ storage: remoteStorage(0), manualRequests: true });
    const manualCuit = ['23', '98765432', '1'].join('');
    harness.loginInput.value = manualCuit;
    harness.loginInput.dispatchEvent(new FakeEvent('input'));
    if (failed) harness.requests[0].onerror();
    else harness.requests[0].onload({ status: 200, responseText: syntheticCsv });
    await harness.flush();
    assertEqual(harness.loginInput.value, manualCuit, 'Una respuesta automática no debe reemplazar el CUIT escrito por el usuario.');
    assertEqual(harness.document.querySelector(`.${domPrefix}-select`).selectedIndex, 0, 'Si el CUIT manual no está en la lista, no debe mostrar otro cliente seleccionado.');
  }
});

test('convierte un enlace publicado pubhtml en CSV conservando la pestaña', async () => {
  const harness = createHarness({ remoteResponses: [{ responseText: syntheticCsv }] });
  harness.buttonByText('Google Sheets').click();
  harness.document.querySelector(`.${domPrefix}-url`).value = 'https://docs.google.com/spreadsheets/d/e/publishedTest/pubhtml#gid=42';
  harness.buttonByText('Guardar').click();
  await harness.flush();
  const url = new URL(harness.requests[0].url);
  assertEqual(url.pathname, '/spreadsheets/d/e/publishedTest/pub', 'El endpoint debe ser pub, no pubhtml.');
  assertEqual(url.searchParams.get('output'), 'csv', 'El enlace publicado debe solicitar CSV.');
  assertEqual(url.searchParams.get('gid'), '42', 'Debe conservar el gid del fragmento.');
  assertEqual(url.hash, '', 'El gid debe viajar al servidor, no quedar en el fragmento.');
});

test('ubica Siguiente de tipo input sin leer una clave oculta anterior', () => {
  const harness = createHarness({ form: true, beforeScript({ document, form }) {
    form.querySelector('button').remove();
    const password = document.createElement('input');
    password.type = 'password';
    password.hidden = true;
    Object.defineProperty(password, 'value', { get() { throw Error('Se leyó una clave oculta'); } });
    const next = document.createElement('input');
    next.id = 'next-input';
    next.type = 'submit';
    next.value = 'Siguiente';
    form.appendChild(password);
    form.appendChild(next);
  } });
  const selector = harness.document.querySelector(`.${domPrefix}-selector-root`);
  assert(selector, 'Debe activar el selector con CUIT visible y clave oculta.');
  assertEqual(selector.nextSibling.id, 'next-input', 'Debe insertarse antes del botón Siguiente.');
  harness.window.dispatchEvent(new FakeEvent('pagehide'));
});

test('Recargar conserva un CUIT escrito antes de iniciar la descarga, incluso si falla', async () => {
  for (const failed of [false, true]) {
    const harness = createHarness({ storage: remoteStorage(Date.now()), manualRequests: true });
    const manualCuit = ['23', '98765432', '1'].join('');
    harness.loginInput.value = manualCuit;
    harness.buttonByText('Recargar').click();
    if (failed) harness.requests[0].onerror();
    else harness.requests[0].onload({ status: 200, responseText: syntheticCsv });
    await harness.flush();
    assertEqual(harness.loginInput.value, manualCuit, 'La recarga no debe reemplazar un CUIT manual anterior.');
    harness.window.dispatchEvent(new FakeEvent('pagehide'));
  }
});

test('el paso de clave no crea interfaz ni lee contraseñas, incluso con CUIT visible', () => {
  for (const type of ['password', 'text']) {
    const harness = createHarness({ form: true, beforeScript({ document, form }) {
      const password = document.createElement('input');
      password.id = 'F1:password';
      password.type = type;
      password.autocomplete = 'current-password';
      Object.defineProperty(password, 'value', { get() { throw Error('Se leyó la clave'); } });
      form.appendChild(password);
    } });
    assert(!harness.document.querySelector(`.${domPrefix}-root`), 'No debe haber controles en el paso de clave.');
    assert(!harness.document.querySelector(`.${domPrefix}-selector-root`), 'No debe haber buscador.');
    assertEqual(harness.storageReads.get(storageKey('dataset')) || 0, 0, 'No debe cargar clientes en el paso de clave.');
    harness.window.dispatchEvent(new FakeEvent('pagehide'));
  }
});

test('ignora CUIT oculto, de solo lectura o dentro de un bloque invisible', () => {
  const setups = [
    ({ loginInput }) => { loginInput.hidden = true; },
    ({ loginInput }) => { loginInput.type = 'hidden'; },
    ({ loginInput }) => { loginInput.readOnly = true; },
    ({ form }) => { form.style.display = 'none'; },
    ({ form }) => { form.style.visibility = 'hidden'; }
  ];
  for (const beforeScript of setups) {
    const harness = createHarness({ form: true, beforeScript });
    assert(!harness.document.querySelector(`.${domPrefix}-selector-root`), 'Un CUIT no editable o invisible no activa el selector.');
    harness.window.dispatchEvent(new FakeEvent('pagehide'));
  }
});

test('retira la UI al pasar a clave, cancela la descarga y restaura CUIT sin duplicados', async () => {
  const harness = createHarness({ storage: remoteStorage(Date.now() - refreshTtl), form: true, manualRequests: true });
  await harness.flush();
  const oldSearch = harness.document.querySelector(`.${domPrefix}-input`);
  const password = harness.document.createElement('input');
  password.id = 'F1:password';
  password.type = 'password';
  Object.defineProperty(password, 'value', { get() { throw Error('Se leyó la clave'); } });
  harness.loginInput.hidden = true;
  harness.form.appendChild(password);
  harness.notifyStepChange();
  await harness.flush();
  assert(!harness.document.querySelector(`.${domPrefix}-selector-root`), 'Debe retirar el buscador al pasar a clave.');
  assert(!harness.document.querySelector(`.${domPrefix}-root`), 'Debe retirar también los controles.');
  assert(!harness.document.querySelector(`style.${domPrefix}-style`), 'Debe liberar los estilos.');
  assert(harness.requests[0].aborted, 'Debe cancelar la descarga pendiente.');
  assertEqual((oldSearch.listeners.get('input') || []).length, 0, 'Debe liberar los listeners del buscador.');
  password.remove();
  harness.loginInput.hidden = false;
  harness.notifyStepChange();
  await harness.flush();
  harness.notifyStepChange();
  await harness.flush();
  assertEqual(harness.document.querySelectorAll(`.${domPrefix}-selector-root`).length, 1, 'El regreso a CUIT reconstruye una sola interfaz.');
  assertEqual(harness.observers.length, 1, 'Debe reutilizar un único observer del panel.');
  assertEqual(harness.observers[0].target, harness.panel, 'Debe observar únicamente el panel del login.');
  assert(!harness.observers[0].settings.attributeFilter.includes('value'), 'No debe observar valores escritos.');
  harness.window.dispatchEvent(new FakeEvent('pagehide'));
  assert(!harness.observers[0].active, 'pagehide debe desconectar la observación.');
});

test('una respuesta durante el cambio de tipo del campo no lee ni sobrescribe la clave', async () => {
  const harness = createHarness({ storage: remoteStorage(Date.now() - refreshTtl), form: true, manualRequests: true });
  harness.loginInput.type = 'password';
  harness.loginInput.autocomplete = 'current-password';
  let passwordAccesses = 0;
  Object.defineProperty(harness.loginInput, 'value', {
    get() { passwordAccesses++; throw Error('Se leyó la clave'); },
    set() { passwordAccesses++; throw Error('Se escribió la clave'); }
  });
  // Resolve before observer cleanup to exercise the asynchronous transition race.
  harness.requests[0].onload({ status: 200, responseText: syntheticCsv });
  await harness.flush();
  assertEqual(passwordAccesses, 0, 'La respuesta no debe acceder al valor de un campo convertido en clave.');
  assertEqual(harness.storage.get(storageKey('dataset')).entries[0].cuit, sampleCompanyCuit, 'La respuesta del paso anterior debe descartarse.');
  harness.notifyStepChange();
  await harness.flush();
  assert(!harness.document.querySelector(`.${domPrefix}-root`), 'La transición debe retirar la UI.');
  harness.window.dispatchEvent(new FakeEvent('pagehide'));
});

test('no confunde su buscador con CUIT al quitar o reemplazar el campo nativo', async () => {
  const harness = createHarness({ form: true });
  harness.loginInput.remove();
  harness.notifyStepChange(harness.form, 'childList', [harness.loginInput]);
  await harness.flush();
  assert(!harness.document.querySelector(`.${domPrefix}-selector-root`), 'Su propio placeholder CUIT no debe mantener activa la interfaz.');
  const replacement = harness.document.createElement('input');
  replacement.name = 'nuevo-cuit';
  replacement.placeholder = 'CUIT/CUIL';
  replacement.type = 'number';
  harness.form.insertBefore(replacement, harness.nextButton);
  harness.notifyStepChange(harness.form, 'childList', [replacement]);
  await harness.flush();
  assertEqual(harness.document.querySelectorAll(`.${domPrefix}-selector-root`).length, 1, 'Debe aceptar el nuevo campo visible.');
  harness.window.dispatchEvent(new FakeEvent('pagehide'));
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
  assert(/pagehide['"]\s*,\s*destroy\b|pagehide[\s\S]*destroy\s*\(/.test(currentScriptText), `[${directory}] destroy() debe registrarse para pagehide.`);
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
