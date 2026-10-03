// ==UserScript==
// @name         ARCA - Login con selector de clientes
// @namespace    https://github.com/Santi-RL/userscripts-contadores-ar
// @version      1.0.8
// @description  Agrega un selector de clientes al login de ARCA con datos desde Google Sheets público o CSV local.
// @author       Scripts-TM
// @match        https://auth.afip.gob.ar/contribuyente_/login.xhtml
// @match        https://auth.arca.gob.ar/contribuyente_/login.xhtml
// @homepageURL  https://github.com/Santi-RL/userscripts-contadores-ar
// @supportURL   https://github.com/Santi-RL/userscripts-contadores-ar/issues
// @updateURL    https://raw.githubusercontent.com/Santi-RL/userscripts-contadores-ar/main/userscripts/arca-login-client-selector/arca-login-client-selector.user.js
// @downloadURL  https://raw.githubusercontent.com/Santi-RL/userscripts-contadores-ar/main/userscripts/arca-login-client-selector/arca-login-client-selector.user.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      docs.google.com
// @connect      googleusercontent.com
// @noframes
// @sandbox      DOM
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const SCRIPT_ID = 'arca-login-client-selector';
  const DOM_PREFIX = 'tm-arca-login-client-selector';
  const STORAGE_PREFIX = 'tm.arca-login-client-selector';
  const ALLOWED_HOSTS = ['docs.google.com', 'googleusercontent.com'];
  const MAX_BOOT_ATTEMPTS = 20;
  const BOOT_DELAY_MS = 250;
  const SEARCH_DEBOUNCE_MS = 120;
  const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  const MAX_VISIBLE_MATCHES = 100;
  const DEFAULT_CONFIG = {
    sourceMode: 'url',
    sourceUrl: ''
  };
  const state = {
    root: null,
    selectorRoot: null,
    controlsBody: null,
    controlsToggle: null,
    controlsCollapsed: false,
    style: null,
    searchInput: null,
    select: null,
    status: null,
    count: null,
    hint: null,
    configPanel: null,
    configInput: null,
    formatPanel: null,
    googleButton: null,
    importButton: null,
    refreshButton: null,
    clearButton: null,
    formatButton: null,
    inputField: null,
    entries: [],
    dataset: null,
    listeners: [],
    fileInputs: new Set(),
    pendingRequest: null,
    inputTimer: null,
    bootTimer: null,
    stepObserver: null,
    stepTimer: null,
    requestToken: 0
  };

  registerMenuCommands();

  function storageKey(key) {
    return `${STORAGE_PREFIX}.${key}`;
  }

  function normalizeText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('es');
  }

  function normalizeHeader(value) {
    return normalizeText(value).replace(/[\s_.-]+/g, '');
  }

  const DIRECT_NAME_HEADERS = [
    'nombrecompleto',
    'nombreyapellido',
    'displayname',
    'fullname',
    'razonsocial',
    'denominacion',
    'cliente'
  ];
  const FIRST_NAME_HEADERS = ['nombre', 'firstname', 'name'];
  const LAST_NAME_HEADERS = ['apellido', 'lastname', 'surname'];
  const CUIT_HEADERS = ['cuit', 'cuil', 'taxid', 'documento'];

  function readConfig() {
    return normalizeConfig(GM_getValue(storageKey('config'), DEFAULT_CONFIG));
  }

  function writeConfig(config) {
    GM_setValue(storageKey('config'), normalizeConfig(config));
  }

  function normalizeConfig(config) {
    const sourceMode = config?.sourceMode === 'file' ? 'file' : 'url';
    let sourceUrl = typeof config?.sourceUrl === 'string' ? config.sourceUrl.trim() : '';

    if (sourceMode === 'url' && sourceUrl) {
      try {
        sourceUrl = normalizeRemoteUrl(sourceUrl);
      } catch {
        // Preserve invalid values so the UI can surface a specific validation error later.
      }
    }

    return {
      sourceMode,
      sourceUrl
    };
  }

  function readDataset() {
    const dataset = GM_getValue(storageKey('dataset'), null);
    if (!dataset || !Array.isArray(dataset.entries)) return null;
    return dataset;
  }

  function writeDataset(dataset) {
    state.dataset = dataset;
    GM_setValue(storageKey('dataset'), dataset);
  }

  function clearDataset() {
    state.dataset = null;
    GM_deleteValue(storageKey('dataset'));
  }

  function listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    state.listeners.push({ target, type, handler, options });
  }

  function removeListenersFor(target) {
    state.listeners = state.listeners.filter((listener) => {
      if (listener.target !== target) return true;
      target.removeEventListener(listener.type, listener.handler, listener.options);
      return false;
    });
  }

  function cancelPendingLoad() {
    state.requestToken += 1;
    const request = state.pendingRequest;
    state.pendingRequest = null;
    request?.abort();
    setLoading(false);
    return state.requestToken;
  }

  function readSelectedCuit() {
    return String(GM_getValue(storageKey('selectedCuit'), '') || '');
  }

  function writeSelectedCuit(cuit) {
    GM_setValue(storageKey('selectedCuit'), String(cuit || ''));
  }

  function clearSelectedCuit() {
    GM_deleteValue(storageKey('selectedCuit'));
  }

  function registerMenuCommands() {
    GM_registerMenuCommand('ARCA: Configurar Google Sheets', configureGoogleSheetsCommand);
    GM_registerMenuCommand('ARCA: Importar CSV local', importCsvCommand);
    GM_registerMenuCommand('ARCA: Borrar datos guardados', clearConfigurationCommand);
    GM_registerMenuCommand('ARCA: Ver formato esperado', toggleFormatCommand);
  }

  function configureGoogleSheetsCommand() {
    if (state.root) {
      showConfigPanel();
      return;
    }

    promptForGoogleSheets();
  }

  function promptForGoogleSheets() {
    const currentConfig = readConfig();
    const currentUrl = currentConfig.sourceUrl || 'https://docs.google.com/spreadsheets/d/...';
    const nextUrl = prompt(
      'Pega un enlace público de Google Sheets. La hoja debe ser visible para cualquiera con el enlace.',
      currentUrl
    );

    if (nextUrl === null) return;
    saveGoogleSheetsUrl(nextUrl);
  }

  function showConfigPanel() {
    if (!state.configPanel || !state.configInput) return;

    expandControls();
    const config = readConfig();
    state.configInput.value = config.sourceMode === 'url' ? config.sourceUrl : '';
    state.configPanel.hidden = false;
    state.formatPanel.hidden = true;
    state.configInput.focus();
    updateStatus('Pegá el enlace público de Google Sheets y guardalo para sincronizar.', false);
  }

  function hideConfigPanel() {
    if (state.configPanel) state.configPanel.hidden = true;
  }

  function saveGoogleSheetsFromPanel() {
    if (!state.configInput) return;
    saveGoogleSheetsUrl(state.configInput.value);
  }

  function saveGoogleSheetsUrl(rawUrl) {
    const sanitizedUrl = String(rawUrl || '').trim();
    if (!sanitizedUrl) {
      updateStatus('No se guardó ninguna URL.', true);
      return;
    }

    let normalizedUrl;
    try {
      normalizedUrl = normalizeRemoteUrl(sanitizedUrl);
    } catch (error) {
      updateStatus(error.message || 'La URL ingresada no es válida.', true);
      return;
    }

    cancelPendingLoad();
    writeConfig({
      sourceMode: 'url',
      sourceUrl: normalizedUrl
    });
    hideConfigPanel();

    if (state.root) {
      void loadEntries({ forceRefresh: true });
    }
  }

  function importCsvCommand() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,text/csv,text/plain';
    input.style.display = 'none';
    input.dataset.tmScript = SCRIPT_ID;
    document.body.appendChild(input);
    state.fileInputs.add(input);

    const removeInput = () => {
      removeListenersFor(input);
      input.remove();
      state.fileInputs.delete(input);
    };
    listen(input, 'cancel', removeInput, { once: true });

    listen(
      input,
      'change',
      async () => {
        let token;
        try {
          const file = input.files && input.files[0];
          if (!file) return;

          token = cancelPendingLoad();
          const rawText = await readLocalFile(file);
          if (token !== state.requestToken) return;
          const entries = parseRemotePayload(rawText, file.name);
          writeConfig({
            sourceMode: 'file',
            sourceUrl: ''
          });
          writeDataset({
            sourceMode: 'file',
            sourceUrl: '',
            loadedAt: Date.now(),
            fileName: file.name,
            entries
          });

          if (state.root) {
            hideConfigPanel();
            setEntries(entries);
            renderMatches();
            updateHint();
            updateStatus(`CSV importado (${entries.length} registros).`, false);
            syncControlsVisibility();
          }
        } catch (error) {
          if (token !== undefined && token !== state.requestToken) return;
          console.warn(`[${SCRIPT_ID}] Error importando CSV:`, error);
          if (state.root) {
            updateStatus(error.message || 'No se pudo importar el CSV.', true);
          }
        } finally {
          removeInput();
        }
      },
      { once: true }
    );

    input.click();
  }

  function clearConfigurationCommand() {
    const shouldClear = confirm(
      '¿Borrar la configuración, caché y los clientes guardados por este script?'
    );
    if (!shouldClear) return;

    cancelPendingLoad();
    clearDataset();
    clearSelectedCuit();
    GM_deleteValue(storageKey('config'));
    setEntries([]);

    if (state.searchInput) state.searchInput.value = '';
    const inputField = getActiveCuitInput();
    if (inputField) inputField.value = '';

    hideConfigPanel();
    if (state.root) {
      renderMatches();
      updateHint();
      updateStatus('Datos guardados borrados. Configura Google Sheets o importa un CSV.', false);
      syncControlsVisibility();
    }
  }

  function readLocalFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        reader.onload = null;
        reader.onerror = null;
        reader.onabort = null;
        if (state.pendingRequest === pending) state.pendingRequest = null;
        callback(value);
      };
      const pending = {
        abort() {
          finish(reject, new Error('La lectura del CSV fue cancelada.'));
          reader.abort();
        }
      };
      state.pendingRequest = pending;
      reader.onload = () => finish(resolve, String(reader.result || ''));
      reader.onerror = () => finish(reject, new Error('No se pudo leer el archivo CSV.'));
      reader.onabort = () => finish(reject, new Error('La lectura del CSV fue cancelada.'));
      try {
        reader.readAsText(file, 'UTF-8');
      } catch (error) {
        finish(reject, error);
      }
    });
  }

  function toggleFormatCommand() {
    if (!state.formatPanel) {
      alert(
        'Formato CSV: columnas Nombre, Apellido y CUIT. También se acepta Nombre completo, Razón Social o Cliente, y columnas extra como Record ID. Separador coma o punto y coma.'
      );
      return;
    }

    const shouldShow = state.controlsCollapsed || state.formatPanel.hidden;
    expandControls();
    state.formatPanel.hidden = !shouldShow;
    if (!state.formatPanel.hidden && state.configPanel) {
      state.configPanel.hidden = true;
    }
  }

  function validateRemoteUrl(candidate) {
    let url;

    try {
      url = new URL(candidate);
    } catch {
      throw new Error('La URL ingresada no es válida.');
    }

    if (url.protocol !== 'https:') {
      throw new Error('Solo se permiten URLs HTTPS.');
    }

    const isAllowedHost = ALLOWED_HOSTS.some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`)
    );

    if (!isAllowedHost) {
      throw new Error('La URL debe pertenecer a docs.google.com o googleusercontent.com.');
    }

    return url.toString();
  }

  function readGidFromUrl(url) {
    const hashParams = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash);
    const gid = url.searchParams.get('gid') || hashParams.get('gid') || '0';
    return /^\d+$/.test(gid) ? gid : '0';
  }

  function normalizeRemoteUrl(candidate) {
    const rawUrl = validateRemoteUrl(candidate);
    const url = new URL(rawUrl);

    if (
      url.hostname === 'docs.google.com' &&
      /^\/spreadsheets\/d\/e\/[^/]+\/pub(?:html)?$/.test(url.pathname)
    ) {
      url.pathname = url.pathname.replace(/\/pubhtml$/, '/pub');
      const hashParams = new URLSearchParams(url.hash.slice(1));
      if (!url.searchParams.has('gid') && hashParams.has('gid')) {
        url.searchParams.set('gid', readGidFromUrl(url));
      }
      url.hash = '';
      url.searchParams.set('output', 'csv');
      return url.toString();
    }

    const sheetMatch = url.pathname.match(/^\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (!sheetMatch) {
      return url.toString();
    }

    const exportUrl = new URL(`https://docs.google.com/spreadsheets/d/${sheetMatch[1]}/export`);
    exportUrl.searchParams.set('format', 'csv');
    exportUrl.searchParams.set('gid', readGidFromUrl(url));
    return exportUrl.toString();
  }

  function detectCsvDelimiter(text) {
    const firstDataLine = String(text || '')
      .split(/\r?\n/)
      .find((line) => line.trim());
    if (!firstDataLine) return ',';

    const commaCount = countDelimiter(firstDataLine, ',');
    const semicolonCount = countDelimiter(firstDataLine, ';');
    return semicolonCount > commaCount ? ';' : ',';
  }

  function countDelimiter(line, delimiter) {
    let count = 0;
    let inQuotes = false;

    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"') {
        if (inQuotes && line[index + 1] === '"') {
          index += 1;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (!inQuotes && char === delimiter) {
        count += 1;
      }
    }

    return count;
  }

  function parseCsv(text, delimiter) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];

      if (inQuotes) {
        if (char === '"') {
          if (text[index + 1] === '"') {
            field += '"';
            index += 1;
          } else {
            inQuotes = false;
          }
        } else {
          field += char;
        }
      } else if (char === '"') {
        inQuotes = true;
      } else if (char === delimiter) {
        row.push(field);
        field = '';
      } else if (char === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else if (char !== '\r') {
        field += char;
      }
    }

    if (field.length > 0 || row.length > 0) {
      row.push(field);
      rows.push(row);
    }

    return rows.filter((currentRow) => currentRow.some((value) => String(value || '').trim()));
  }

  function parseCsvData(csvText) {
    const normalizedText = String(csvText || '').replace(/^\uFEFF/, '');
    const delimiter = detectCsvDelimiter(normalizedText);
    const rows = parseCsv(normalizedText, delimiter);
    if (rows.length <= 1) return [];

    const headers = rows[0].map((header) => normalizeHeader(header));
    const dataRows = rows.slice(1);

    return normalizeEntries(
      dataRows.map((values) => {
        const record = {};
        headers.forEach((header, index) => {
          record[header] = values[index];
        });
        return record;
      })
    );
  }

  function hasAnyHeader(headers, candidates) {
    return candidates.some((candidate) => headers.includes(candidate));
  }

  function hasRecognizedClientHeaders(csvText) {
    const normalizedText = String(csvText || '').replace(/^\uFEFF/, '');
    const delimiter = detectCsvDelimiter(normalizedText);
    const rows = parseCsv(normalizedText, delimiter);
    if (!rows.length) return false;

    const headers = rows[0].map((header) => normalizeHeader(header));
    const hasNameHeader =
      hasAnyHeader(headers, DIRECT_NAME_HEADERS) ||
      hasAnyHeader(headers, FIRST_NAME_HEADERS) ||
      hasAnyHeader(headers, LAST_NAME_HEADERS);
    const hasCuitHeader = hasAnyHeader(headers, CUIT_HEADERS);

    return hasNameHeader && hasCuitHeader;
  }

  function parseRemotePayload(rawText, sourceLabel) {
    const trimmedText = String(rawText || '').trim();
    if (!trimmedText) {
      throw new Error(`El origen ${sourceLabel} no contiene datos.`);
    }

    const entries = parseCsvData(trimmedText);
    if (!entries.length) {
      if (!hasRecognizedClientHeaders(trimmedText)) {
        throw new Error(
          `No se detectaron los encabezados necesarios Nombre, Apellido y CUIT en la fila 1 de ${sourceLabel}.`
        );
      }
      throw new Error(`No se encontraron registros válidos en ${sourceLabel}.`);
    }

    return entries;
  }

  function explainHtmlResponse(text) {
    const trimmedText = String(text || '').trim();
    if (!/^<!doctype html|^<html/i.test(trimmedText)) return '';

    const normalizedText = normalizeText(trimmedText);
    if (
      normalizedText.includes('servicelogin') ||
      normalizedText.includes('choose an account') ||
      normalizedText.includes('elige una cuenta') ||
      normalizedText.includes('inicia sesion') ||
      normalizedText.includes('sign in')
    ) {
      return 'Google no devolvió un CSV público. Publica la hoja o habilita acceso para cualquiera con el enlace.';
    }

    if (
      normalizedText.includes('request access') ||
      normalizedText.includes('solicitar acceso') ||
      normalizedText.includes('you need access') ||
      normalizedText.includes('access denied') ||
      normalizedText.includes('acceso denegado')
    ) {
      return 'El link de Google Sheets no es público. Usa acceso para cualquiera con el enlace o importa un CSV local.';
    }

    return 'Google devolvió HTML en lugar de CSV. Revisa que el link sea una hoja pública o publicada como CSV.';
  }

  function normalizeEntries(items) {
    const normalized = [];

    items.forEach((item) => {
      const normalizedItem = normalizeEntry(item);
      if (normalizedItem) {
        normalized.push(normalizedItem);
      }
    });

    return normalized.sort((left, right) =>
      left.name.localeCompare(right.name, 'es', { sensitivity: 'base' })
    );
  }

  function readFirstValue(item, keys) {
    for (const key of keys) {
      if (item[key] !== undefined && item[key] !== null && String(item[key]).trim()) {
        return item[key];
      }
    }
    return '';
  }

  function normalizeEntry(item) {
    if (!item || typeof item !== 'object') return null;

    const directName = readFirstValue(item, DIRECT_NAME_HEADERS);
    const firstName = readFirstValue(item, FIRST_NAME_HEADERS);
    const lastName = readFirstValue(item, LAST_NAME_HEADERS);
    const cuit = String(readFirstValue(item, CUIT_HEADERS))
      .replace(/\D/g, '')
      .trim();

    const composedName = directName
      ? String(directName).trim()
      : [String(lastName).trim(), String(firstName).trim()].filter(Boolean).join(', ');

    if (!composedName || cuit.length !== 11) {
      return null;
    }

    return {
      name: composedName,
      cuit,
      searchKey: normalizeText(`${composedName} ${cuit}`)
    };
  }

  function formatCuit(cuit) {
    const digits = String(cuit || '').replace(/\D/g, '');
    if (digits.length !== 11) return digits;
    return `${digits.slice(0, 2)}-${digits.slice(2, 10)}-${digits.slice(10)}`;
  }

  function createStyle() {
    const existingStyle = document.querySelector(`style.${DOM_PREFIX}-style`);
    if (existingStyle) return existingStyle;

    const style = document.createElement('style');
    style.className = `${DOM_PREFIX}-style`;
    style.dataset.tmScript = SCRIPT_ID;
    style.textContent = `
      .${DOM_PREFIX}-root,
      .${DOM_PREFIX}-selector-root {
        box-sizing: border-box;
        width: 100%;
      }
      .${DOM_PREFIX}-root {
        margin-top: 12px;
        padding: 12px;
        border: 1px solid #d8dde3;
        border-radius: 6px;
        background: #f8fafc;
        color: #1f2933;
      }
      .${DOM_PREFIX}-root[data-collapsed="true"] {
        padding: 10px 12px;
      }
      .${DOM_PREFIX}-selector-root {
        margin: 12px 0 8px;
      }
      .${DOM_PREFIX}-title {
        display: block;
        width: 100%;
        margin: 0 0 8px;
        padding: 0;
        border: 0;
        background: transparent;
        color: inherit;
        cursor: pointer;
        font-family: inherit;
        font-size: 14px;
        font-weight: 700;
        text-align: inherit;
      }
      .${DOM_PREFIX}-root[data-collapsed="true"] .${DOM_PREFIX}-title {
        margin-bottom: 0;
      }
      .${DOM_PREFIX}-controls[hidden] {
        display: none;
      }
      .${DOM_PREFIX}-input,
      .${DOM_PREFIX}-select,
      .${DOM_PREFIX}-url {
        box-sizing: border-box;
        width: 100%;
        margin: 0 0 8px;
        padding: 8px 10px;
        border: 1px solid #c7d0da;
        border-radius: 4px;
        font-size: 14px;
        line-height: 1.4;
        background: #ffffff;
      }
      .${DOM_PREFIX}-input:focus,
      .${DOM_PREFIX}-select:focus,
      .${DOM_PREFIX}-url:focus {
        outline: 0;
        border-color: #0b6aa2;
        box-shadow: 0 0 0 2px rgba(11, 106, 162, 0.15);
      }
      .${DOM_PREFIX}-actions,
      .${DOM_PREFIX}-panel-actions,
      .${DOM_PREFIX}-meta {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
      }
      .${DOM_PREFIX}-actions {
        margin-bottom: 8px;
      }
      .${DOM_PREFIX}-meta {
        justify-content: space-between;
      }
      .${DOM_PREFIX}-status,
      .${DOM_PREFIX}-count,
      .${DOM_PREFIX}-hint,
      .${DOM_PREFIX}-note,
      .${DOM_PREFIX}-format {
        font-size: 12px;
        color: #5b6773;
      }
      .${DOM_PREFIX}-status[data-error="true"] {
        color: #b42318;
      }
      .${DOM_PREFIX}-button {
        border: 0;
        border-radius: 4px;
        background: #0b6aa2;
        color: #ffffff;
        cursor: pointer;
        padding: 7px 10px;
        font-size: 12px;
      }
      .${DOM_PREFIX}-button-secondary {
        background: #3d4f60;
      }
      .${DOM_PREFIX}-button-danger {
        background: #9f1f18;
      }
      .${DOM_PREFIX}-button[disabled] {
        opacity: 0.65;
        cursor: wait;
      }
      .${DOM_PREFIX}-panel {
        box-sizing: border-box;
        margin: 0 0 8px;
        padding: 10px;
        border: 1px solid #d8dde3;
        border-radius: 4px;
        background: #ffffff;
      }
      .${DOM_PREFIX}-panel[hidden] {
        display: none;
      }
      .${DOM_PREFIX}-note {
        margin: 0 0 8px;
      }
      .${DOM_PREFIX}-format {
        line-height: 1.45;
      }
    `;
    document.head.appendChild(style);
    return style;
  }

  function createButton(text, className) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `${DOM_PREFIX}-button${className ? ` ${className}` : ''}`;
    button.textContent = text;
    return button;
  }

  function isAfterReference(reference, element) {
    if (!reference?.compareDocumentPosition) return true;
    return Boolean(reference.compareDocumentPosition(element) & 4);
  }

  function findHelpInsertionTarget(inputField) {
    const candidateSelectors = ['a', 'button', 'span', 'p', 'div'];
    const candidates = candidateSelectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
    const helpElement = candidates.find(
      (element) => isAfterReference(inputField, element) && normalizeText(element.textContent).trim() === 'ayuda'
    );
    if (!helpElement || !helpElement.parentElement) return null;

    let anchor = helpElement;
    while (
      anchor.parentElement &&
      anchor.parentElement !== document.body &&
      normalizeText(anchor.parentElement.textContent).trim() === 'ayuda'
    ) {
      anchor = anchor.parentElement;
    }

    return {
      parent: anchor.parentElement,
      beforeNode: anchor.nextSibling
    };
  }

  function nodeText(element) {
    const isButton = element.tagName === 'BUTTON' ||
      (element.tagName === 'INPUT' && ['button', 'submit'].includes(element.type));
    const value = isButton ? element.value : '';
    return normalizeText([element.textContent, value, element.getAttribute('aria-label')].join(' ')).trim();
  }

  function findNextButtonInsertionTarget(inputField) {
    const candidates = ['button', 'input', 'a']
      .flatMap((selector) => Array.from(document.querySelectorAll(selector)))
      .filter((element) => element.tagName !== 'INPUT' || ['button', 'submit'].includes(element.type));
    const nextButton = candidates.find((element) => !isOwnedNode(element) && isVisible(element) &&
      isAfterReference(inputField, element) && nodeText(element) === 'siguiente');
    if (!nextButton?.parentElement) return null;

    return {
      parent: nextButton.parentElement,
      beforeNode: nextButton
    };
  }

  function resolveSelectorInsertion(inputField) {
    const nextButtonTarget = findNextButtonInsertionTarget(inputField);
    if (nextButtonTarget?.parent) return nextButtonTarget;

    return {
      parent: inputField.parentElement,
      beforeNode: null
    };
  }

  function resolveControlsInsertion(inputField) {
    const helpTarget = findHelpInsertionTarget(inputField);
    if (helpTarget?.parent) return helpTarget;

    return {
      parent: inputField.parentElement,
      beforeNode: null
    };
  }

  function insertUiNode(parent, node, beforeNode = null) {
    if (beforeNode) {
      parent.insertBefore(node, beforeNode);
    } else {
      parent.appendChild(node);
    }
  }

  function hasLoadedDataset() {
    return Boolean(state.entries.length);
  }

  function setControlsCollapsed(isCollapsed) {
    if (!state.root || !state.controlsBody || !state.controlsToggle) return;

    state.controlsCollapsed = Boolean(isCollapsed);
    state.controlsBody.hidden = state.controlsCollapsed;
    state.root.dataset.collapsed = state.controlsCollapsed ? 'true' : 'false';
    state.controlsToggle.setAttribute('aria-expanded', String(!state.controlsCollapsed));
  }

  function syncControlsVisibility() {
    setControlsCollapsed(hasLoadedDataset());
  }

  function expandControls() {
    setControlsCollapsed(false);
  }

  function toggleControls() {
    setControlsCollapsed(!state.controlsCollapsed);
  }

  function buildUi(selectorInsertion, controlsInsertion) {
    const existingRoot = document.querySelector(`.${DOM_PREFIX}-root`);
    if (existingRoot) return existingRoot;

    const root = document.createElement('div');
    root.className = `${DOM_PREFIX}-root`;
    root.dataset.tmScript = SCRIPT_ID;

    const selectorRoot = document.createElement('div');
    selectorRoot.className = `${DOM_PREFIX}-selector-root`;
    selectorRoot.dataset.tmScript = SCRIPT_ID;

    const title = document.createElement('button');
    title.type = 'button';
    title.className = `${DOM_PREFIX}-title`;
    title.textContent = 'ARCA - selector de clientes';
    title.setAttribute('aria-expanded', 'true');

    const actions = document.createElement('div');
    actions.className = `${DOM_PREFIX}-actions`;

    const googleButton = createButton('Google Sheets');
    const importButton = createButton('Importar CSV', `${DOM_PREFIX}-button-secondary`);
    const refreshButton = createButton('Recargar', `${DOM_PREFIX}-button-secondary`);
    const clearButton = createButton('Borrar datos', `${DOM_PREFIX}-button-danger`);
    const formatButton = createButton('Formato esperado', `${DOM_PREFIX}-button-secondary`);
    const controlsBody = document.createElement('div');
    controlsBody.className = `${DOM_PREFIX}-controls`;

    actions.appendChild(googleButton);
    actions.appendChild(importButton);
    actions.appendChild(refreshButton);
    actions.appendChild(clearButton);
    actions.appendChild(formatButton);

    const configPanel = document.createElement('div');
    configPanel.className = `${DOM_PREFIX}-panel`;
    configPanel.hidden = true;

    const configNote = document.createElement('p');
    configNote.className = `${DOM_PREFIX}-note`;
    configNote.textContent =
      'Usa un enlace público de Google Sheets. Cualquiera con acceso al link puede ver esa hoja.';

    const configInput = document.createElement('input');
    configInput.type = 'url';
    configInput.className = `${DOM_PREFIX}-url`;
    configInput.placeholder = 'https://docs.google.com/spreadsheets/d/...';

    const configActions = document.createElement('div');
    configActions.className = `${DOM_PREFIX}-panel-actions`;
    const saveConfigButton = createButton('Guardar');
    const cancelConfigButton = createButton('Cancelar', `${DOM_PREFIX}-button-secondary`);
    configActions.appendChild(saveConfigButton);
    configActions.appendChild(cancelConfigButton);

    configPanel.appendChild(configNote);
    configPanel.appendChild(configInput);
    configPanel.appendChild(configActions);

    const formatPanel = document.createElement('div');
    formatPanel.className = `${DOM_PREFIX}-panel ${DOM_PREFIX}-format`;
    formatPanel.hidden = true;
    formatPanel.textContent =
      'CSV esperado: columnas Nombre, Apellido y CUIT. También acepta Nombre completo, Razón Social o Cliente, y columnas extra como Record ID. Separador coma o punto y coma. Para Excel, guardar como CSV.';

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = `${DOM_PREFIX}-input`;
    searchInput.placeholder = 'Buscar por nombre o CUIT...';
    searchInput.autocomplete = 'off';

    const select = document.createElement('select');
    select.className = `${DOM_PREFIX}-select`;

    const hint = document.createElement('div');
    hint.className = `${DOM_PREFIX}-hint`;

    const meta = document.createElement('div');
    meta.className = `${DOM_PREFIX}-meta`;

    const status = document.createElement('div');
    status.className = `${DOM_PREFIX}-status`;

    const count = document.createElement('div');
    count.className = `${DOM_PREFIX}-count`;

    meta.appendChild(status);
    meta.appendChild(count);

    controlsBody.appendChild(actions);
    controlsBody.appendChild(configPanel);
    controlsBody.appendChild(formatPanel);
    root.appendChild(title);
    root.appendChild(controlsBody);
    selectorRoot.appendChild(searchInput);
    selectorRoot.appendChild(select);
    selectorRoot.appendChild(hint);
    selectorRoot.appendChild(meta);
    insertUiNode(selectorInsertion.parent, selectorRoot, selectorInsertion.beforeNode);
    insertUiNode(controlsInsertion.parent, root, controlsInsertion.beforeNode);

    state.root = root;
    state.selectorRoot = selectorRoot;
    state.controlsBody = controlsBody;
    state.controlsToggle = title;
    state.searchInput = searchInput;
    state.select = select;
    state.hint = hint;
    state.status = status;
    state.count = count;
    state.configPanel = configPanel;
    state.configInput = configInput;
    state.formatPanel = formatPanel;
    state.googleButton = googleButton;
    state.importButton = importButton;
    state.refreshButton = refreshButton;
    state.clearButton = clearButton;
    state.formatButton = formatButton;

    syncControlsVisibility();

    listen(title, 'click', toggleControls);
    listen(searchInput, 'input', handleSearchInput);
    listen(searchInput, 'keydown', handleSearchKeydown);
    listen(select, 'change', handleSelectChange);
    listen(googleButton, 'click', configureGoogleSheetsCommand);
    listen(importButton, 'click', importCsvCommand);
    listen(refreshButton, 'click', () => {
      void handleRefresh();
    });
    listen(clearButton, 'click', clearConfigurationCommand);
    listen(formatButton, 'click', toggleFormatCommand);
    listen(saveConfigButton, 'click', saveGoogleSheetsFromPanel);
    listen(cancelConfigButton, 'click', hideConfigPanel);
    listen(configInput, 'keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        saveGoogleSheetsFromPanel();
      }
    });

    return root;
  }

  function setLoading(isLoading) {
    if (!state.refreshButton) return;
    state.refreshButton.disabled = isLoading;
    state.refreshButton.textContent = isLoading ? 'Cargando...' : 'Recargar';
  }

  function updateStatus(message, isError) {
    if (!state.status) return;
    state.status.textContent = message;
    state.status.dataset.error = isError ? 'true' : 'false';
  }

  function updateHint() {
    if (!state.hint) return;
    const config = readConfig();
    const dataset = state.dataset;

    if (config.sourceMode === 'file' && dataset?.fileName) {
      state.hint.textContent = `Origen actual: CSV local (${dataset.fileName}). Para cambios, importa el archivo otra vez.`;
      return;
    }

    if (config.sourceMode === 'url' && config.sourceUrl) {
      try {
        const updatedAt = datasetMatchesConfig(config, dataset) && Number.isFinite(dataset.loadedAt)
          ? ` Última actualización: ${new Date(dataset.loadedAt).toLocaleString('es-AR')}.`
          : '';
        state.hint.textContent = `Origen actual: Google Sheets público (${new URL(config.sourceUrl).hostname}).${updatedAt}`;
      } catch {
        state.hint.textContent = 'La URL configurada necesita revisión.';
      }
      return;
    }

    state.hint.textContent = 'Configura un Google Sheets público o importa un CSV local.';
  }

  function setEntries(entries) {
    state.entries = Array.isArray(entries) ? entries : [];
  }

  function renderMatches({ preserveSelection = false, preserveInput = false } = {}) {
    if (!state.select || !state.inputField || !state.searchInput || !state.count) return;
    const inputField = getActiveCuitInput();
    if (!inputField) return;

    const searchText = state.searchInput.value.trim();
    const normalizedSearch = normalizeText(searchText);
    const cuitSearch = searchText.replace(/\D/g, '');
    const lastSelectedCuit = preserveInput
      ? String(inputField.value || '').replace(/\D/g, '')
      : readSelectedCuit();

    const matches = [];
    let totalMatches = 0;
    let preferredEntry = null;
    for (const entry of state.entries) {
      const matchesName = normalizedSearch && entry.searchKey.includes(normalizedSearch);
      const matchesCuit = cuitSearch && entry.cuit.includes(cuitSearch);
      if (searchText && !matchesName && !matchesCuit) continue;
      totalMatches += 1;
      if (matches.length < MAX_VISIBLE_MATCHES) matches.push(entry);
      if (entry.cuit === lastSelectedCuit) preferredEntry = entry;
    }
    if (preferredEntry && !matches.some((entry) => entry.cuit === lastSelectedCuit)) {
      matches[matches.length - 1] = preferredEntry;
    }

    state.select.innerHTML = '';

    if (!matches.length) {
      const option = new Option('No se encontraron coincidencias.', '', false, false);
      option.disabled = true;
      state.select.add(option);
      if (!preserveSelection && !preserveInput) applySelectedCuit('');
      state.count.textContent = '0 coincidencias';
      return;
    }

    const placeholder = new Option('Selecciona un cliente...', '', true, false);
    placeholder.disabled = true;
    state.select.add(placeholder);

    matches.forEach((entry) => {
      state.select.add(new Option(`${entry.name} - ${formatCuit(entry.cuit)}`, entry.cuit));
    });

    const preferredIndex = matches.findIndex((entry) => entry.cuit === lastSelectedCuit);
    if (preferredIndex >= 0) {
      state.select.selectedIndex = preferredIndex + 1;
      if (!preserveInput) applySelectedCuit(state.select.options[state.select.selectedIndex].value);
    } else if (searchText && !preserveInput) {
      state.select.selectedIndex = 1;
      applySelectedCuit(state.select.options[1].value);
    } else {
      state.select.selectedIndex = 0;
      if (!preserveInput) applySelectedCuit('');
    }

    state.count.textContent = totalMatches > matches.length
      ? `${matches.length} de ${totalMatches} coincidencias. Refiná la búsqueda para ver otros clientes.`
      : `${totalMatches} coincidencia${totalMatches === 1 ? '' : 's'}`;
  }

  function applySelectedCuit(cuit) {
    const inputField = getActiveCuitInput();
    if (!inputField) return;
    const normalizedCuit = String(cuit || '').replace(/\D/g, '');
    inputField.value = normalizedCuit;
    if (normalizedCuit) {
      if (readSelectedCuit() !== normalizedCuit) writeSelectedCuit(normalizedCuit);
    } else {
      if (readSelectedCuit()) clearSelectedCuit();
    }
    inputField.dispatchEvent(new Event('input', { bubbles: true }));
    inputField.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function handleSearchInput() {
    if (state.inputTimer) {
      clearTimeout(state.inputTimer);
    }

    state.inputTimer = setTimeout(() => {
      state.inputTimer = null;
      renderMatches();
    }, SEARCH_DEBOUNCE_MS);
  }

  function handleSearchKeydown(event) {
    if (!state.select || !state.select.options.length) return;
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;

    event.preventDefault();
    const direction = event.key === 'ArrowDown' ? 1 : -1;
    let nextIndex = state.select.selectedIndex;

    for (let attempts = 0; attempts < state.select.options.length; attempts += 1) {
      nextIndex += direction;
      if (nextIndex < 0) nextIndex = state.select.options.length - 1;
      if (nextIndex >= state.select.options.length) nextIndex = 0;
      if (!state.select.options[nextIndex].disabled) break;
    }

    state.select.selectedIndex = nextIndex;
    applySelectedCuit(state.select.options[nextIndex].value);
  }

  function handleSelectChange() {
    if (!state.select) return;
    applySelectedCuit(state.select.value || '');
  }

  async function handleRefresh() {
    const config = readConfig();
    if (config.sourceMode === 'file') {
      updateStatus('Elegí el CSV actualizado para reimportarlo.', false);
      importCsvCommand();
      return;
    }

    await loadEntries({ forceRefresh: true });
  }

  function datasetMatchesConfig(config, dataset) {
    if (!dataset || !Array.isArray(dataset.entries)) return false;
    if (config.sourceMode !== dataset.sourceMode) return false;
    if (config.sourceMode === 'url') return config.sourceUrl && config.sourceUrl === dataset.sourceUrl;
    return config.sourceMode === 'file' && Array.isArray(dataset.entries);
  }

  function fetchRemoteText(url) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        if (state.pendingRequest === pending) state.pendingRequest = null;
        callback(value);
      };
      let handle;
      const pending = {
        abort() {
          finish(reject, new Error('La carga remota fue cancelada.'));
          handle?.abort();
        }
      };
      state.pendingRequest = pending;
      try {
        handle = GM_xmlhttpRequest({
          method: 'GET',
          url,
          anonymous: true,
          timeout: 20_000,
          headers: {
            'Cache-Control': 'no-cache'
          },
          onload(response) {
            if (response.status >= 200 && response.status < 300) {
              finish(resolve, response.responseText);
              return;
            }
            finish(reject, new Error(`La URL respondió con estado ${response.status}.`));
          },
          onerror() {
            finish(reject, new Error('Falló la carga remota.'));
          },
          ontimeout() {
            finish(reject, new Error('La carga remota superó el tiempo límite.'));
          },
          onabort() {
            finish(reject, new Error('La carga remota fue cancelada.'));
          }
        });
      } catch (error) {
        finish(reject, error);
      }
    });
  }

  async function loadEntries({ forceRefresh = false } = {}) {
    const token = cancelPendingLoad();
    let config = readConfig();
    const cachedDataset = state.dataset;

    updateHint();

    if (config.sourceMode === 'file') {
      if (!datasetMatchesConfig(config, cachedDataset) || !cachedDataset.entries.length) {
        setEntries([]);
        renderMatches();
        updateStatus('No hay CSV importado. Usa Importar CSV.', false);
        syncControlsVisibility();
        return;
      }

      setEntries(cachedDataset.entries);
      renderMatches({ preserveInput: hasManualInput() });
      updateStatus(`Datos locales listos (${cachedDataset.entries.length} registros).`, false);
      syncControlsVisibility();
      return;
    }

    if (!config.sourceUrl) {
      setEntries([]);
      renderMatches();
      updateStatus('Configura Google Sheets o importa un CSV local.', false);
      syncControlsVisibility();
      return;
    }

    try {
      const normalizedSourceUrl = normalizeRemoteUrl(config.sourceUrl);
      config = {
        ...config,
        sourceUrl: normalizedSourceUrl
      };
      writeConfig(config);
    } catch (error) {
      setEntries([]);
      renderMatches();
      updateStatus(error.message || 'La URL configurada no es válida.', true);
      syncControlsVisibility();
      return;
    }

    const hasCache = datasetMatchesConfig(config, cachedDataset) && cachedDataset.entries.length;
    setEntries(hasCache ? cachedDataset.entries : []);
    renderMatches({ preserveSelection: !hasCache, preserveInput: hasManualInput() });
    syncControlsVisibility();
    const cacheAge = Date.now() - cachedDataset?.loadedAt;
    if (!forceRefresh && hasCache && Number.isFinite(cacheAge) && cacheAge >= 0 && cacheAge < CACHE_TTL_MS) {
      updateStatus(`Lista guardada disponible (${cachedDataset.entries.length} registros). Se actualiza cada 24 horas o con Recargar.`, false);
      return;
    }

    setLoading(true);
    updateStatus('Actualizando Google Sheets...', false);
    const preserveInputAtRequest = hasManualInput();
    const inputAtRequest = readCurrentCuit();

    try {
      const remoteText = await fetchRemoteText(config.sourceUrl);
      if (token !== state.requestToken || !getActiveCuitInput()) return;

      const htmlError = explainHtmlResponse(remoteText);
      if (htmlError) {
        throw new Error(htmlError);
      }

      const entries = parseRemotePayload(remoteText, config.sourceUrl);
      writeDataset({
        sourceMode: 'url',
        sourceUrl: config.sourceUrl,
        loadedAt: Date.now(),
        entries
      });
      updateHint();
      setEntries(entries);
      renderMatches({ preserveInput: preserveInputAtRequest || readCurrentCuit() !== inputAtRequest });
      updateStatus(`Google Sheets actualizado (${entries.length} registros).`, false);
      syncControlsVisibility();
    } catch (error) {
      if (token !== state.requestToken || !getActiveCuitInput()) return;
      console.warn(`[${SCRIPT_ID}] Error cargando Google Sheets:`, error);

      if (datasetMatchesConfig(config, cachedDataset) && cachedDataset.entries.length) {
        setEntries(cachedDataset.entries);
        renderMatches({ preserveInput: preserveInputAtRequest || readCurrentCuit() !== inputAtRequest });
        updateStatus(
          `Se usó la lista guardada (${cachedDataset.entries.length} registros). ${error.message}`,
          true
        );
        syncControlsVisibility();
      } else {
        setEntries([]);
        renderMatches({ preserveInput: preserveInputAtRequest || readCurrentCuit() !== inputAtRequest });
        updateStatus(error.message || 'No se pudieron cargar los datos remotos.', true);
        syncControlsVisibility();
      }
    } finally {
      if (token === state.requestToken) {
        setLoading(false);
      }
    }
  }

  function isUsableTextInput(element) {
    if (!element || element.tagName !== 'INPUT') return false;
    const type = String(element.getAttribute('type') || 'text').toLowerCase();
    return ['', 'text', 'tel', 'search', 'number'].includes(type) &&
      !element.disabled && !element.readOnly && !isOwnedNode(element) && isVisible(element);
  }

  function isOwnedNode(element) {
    for (let node = element; node; node = node.parentElement) {
      if (node.getAttribute?.('data-tm-script') === SCRIPT_ID) return true;
    }
    return false;
  }

  function isVisible(element) {
    if (!element.isConnected || !element.getClientRects().length) return false;
    for (let node = element; node; node = node.parentElement) {
      const style = window.getComputedStyle(node);
      if (node.hidden || style.display === 'none' ||
          style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    }
    return true;
  }

  function isPasswordInput(input) {
    // Inspect only field metadata, including when the eye button reveals the key.
    return input.type === 'password' ||
      /password|clave/.test(inputTextSignature(input));
  }

  function hasManualInput() {
    const value = String(readCurrentCuit() || '').replace(/\D/g, '');
    return Boolean(value && value !== readSelectedCuit());
  }

  function inputTextSignature(input) {
    const labels = input.labels ? Array.from(input.labels).map((label) => label.textContent) : [];
    return normalizeText(
      [
        input.id,
        input.name,
        input.placeholder,
        input.getAttribute('aria-label'),
        input.getAttribute('autocomplete'),
        ...labels
      ].join(' ')
    );
  }

  function findCuitInput() {
    const inputs = Array.from(document.querySelectorAll('input'));
    if (inputs.some((input) => !isOwnedNode(input) && isVisible(input) && isPasswordInput(input))) {
      return null;
    }
    const legacyInput = document.getElementById('F1:username');
    if (isUsableTextInput(legacyInput)) return legacyInput;

    const legacyNameInput = document.querySelector('input[name="F1:username"]');
    if (isUsableTextInput(legacyNameInput)) return legacyNameInput;

    return (
      inputs.find((input) => {
        if (!isUsableTextInput(input) || isPasswordInput(input)) return false;
        const signature = inputTextSignature(input);
        return signature.includes('cuit') || signature.includes('cuil');
      }) || null
    );
  }

  function getActiveCuitInput() {
    return state.inputField && findCuitInput() === state.inputField ? state.inputField : null;
  }

  function readCurrentCuit() {
    return getActiveCuitInput()?.value;
  }

  function removeUi() {
    cancelPendingLoad();
    for (const { target, type, handler, options } of state.listeners) {
      target.removeEventListener(type, handler, options);
    }
    state.listeners = [];
    for (const input of state.fileInputs) input.remove();
    state.fileInputs.clear();
    if (state.inputTimer) {
      clearTimeout(state.inputTimer);
      state.inputTimer = null;
    }

    if (state.bootTimer) {
      clearTimeout(state.bootTimer);
      state.bootTimer = null;
    }

    if (state.root) {
      state.root.remove();
      state.root = null;
    }

    state.controlsBody = null;
    state.controlsToggle = null;
    state.controlsCollapsed = false;

    if (state.selectorRoot) {
      state.selectorRoot.remove();
      state.selectorRoot = null;
    }

    if (state.style) {
      state.style.remove();
      state.style = null;
    }
    for (const key of [
      'searchInput', 'select', 'status', 'count', 'hint', 'configPanel', 'configInput',
      'formatPanel', 'googleButton', 'importButton', 'refreshButton', 'clearButton',
      'formatButton', 'inputField', 'dataset'
    ]) state[key] = null;
    state.entries = [];
  }

  function destroy() {
    state.stepObserver?.disconnect();
    state.stepObserver = null;
    if (state.stepTimer !== null) clearTimeout(state.stepTimer);
    state.stepTimer = null;
    removeUi();
  }

  function observeLoginStep() {
    if (state.stepObserver) return true;
    const form = document.getElementById('F1') || document.querySelector('form');
    const scope = form?.parentElement;
    // Watch only the login panel, including replacement of its form; never the whole page.
    if (!scope || scope === document.body || scope === document.documentElement) return false;
    state.stepObserver = new MutationObserver((records) => {
      const relevant = records.some((record) => !isOwnedNode(record.target) &&
        (record.type !== 'childList' ||
          [...record.addedNodes, ...record.removedNodes].some((node) => !isOwnedNode(node))));
      if (!relevant || state.stepTimer !== null) return;
      state.stepTimer = setTimeout(() => {
        state.stepTimer = null;
        if (!init() && state.root) removeUi();
      }, 0);
    });
    state.stepObserver.observe(scope, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['type', 'hidden', 'style', 'class', 'readonly', 'disabled', 'autocomplete']
    });
    return true;
  }

  function init() {
    const inputField = findCuitInput();
    if (!inputField) return false;
    if (state.root?.isConnected && state.selectorRoot?.isConnected && state.inputField === inputField) {
      return true;
    }
    if (state.root) removeUi();

    const selectorInsertion = resolveSelectorInsertion(inputField);
    const controlsInsertion = resolveControlsInsertion(inputField);
    if (!selectorInsertion.parent || !controlsInsertion.parent) return false;

    state.inputField = inputField;
    state.dataset = readDataset();
    state.style = createStyle();
    buildUi(selectorInsertion, controlsInsertion);
    updateStatus('Cargando configuración...', false);
    void loadEntries({ forceRefresh: false });
    return true;
  }

  function bootstrap(attempt) {
    const observing = observeLoginStep();
    if (init() || observing) return;
    if (attempt >= MAX_BOOT_ATTEMPTS) return;

    state.bootTimer = setTimeout(() => {
      state.bootTimer = null;
      bootstrap(attempt + 1);
    }, BOOT_DELAY_MS);
  }

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        bootstrap(0);
      },
      { once: true }
    );
  } else {
    bootstrap(0);
  }

  // These two lifecycle hooks stay active for back/forward cache restorations.
  window.addEventListener('pagehide', destroy);
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) bootstrap(0);
  });
})();
