// ==UserScript==
// @name         ARCA - Login con selector de clientes
// @namespace    https://github.com/Santi-RL/userscripts-contadores-ar
// @version      1.0.3
// @description  Agrega un selector de clientes al login de ARCA con datos desde Google Sheets publico o CSV local.
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
    inputTimer: null,
    bootTimer: null,
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
    GM_setValue(storageKey('dataset'), dataset);
  }

  function clearDataset() {
    GM_deleteValue(storageKey('dataset'));
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
      'Pega un link publico de Google Sheets. La hoja debe ser visible para cualquiera con el enlace.',
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
    updateStatus('Pega el link publico de Google Sheets y guardalo para sincronizar.', false);
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
      updateStatus('No se guardo ninguna URL.', true);
      return;
    }

    let normalizedUrl;
    try {
      normalizedUrl = normalizeRemoteUrl(sanitizedUrl);
    } catch (error) {
      updateStatus(error.message || 'La URL ingresada no es valida.', true);
      return;
    }

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

    input.addEventListener(
      'change',
      async () => {
        try {
          const file = input.files && input.files[0];
          if (!file) return;

          const rawText = await file.text();
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
          console.warn(`[${SCRIPT_ID}] Error importando CSV:`, error);
          if (state.root) {
            updateStatus(error.message || 'No se pudo importar el CSV.', true);
          }
        } finally {
          input.remove();
        }
      },
      { once: true }
    );

    input.click();
  }

  function clearConfigurationCommand() {
    const shouldClear = confirm(
      'Borrar la configuracion, cache y clientes guardados por este script?'
    );
    if (!shouldClear) return;

    clearDataset();
    clearSelectedCuit();
    GM_deleteValue(storageKey('config'));
    setEntries([]);

    if (state.searchInput) state.searchInput.value = '';
    if (state.inputField) state.inputField.value = '';

    hideConfigPanel();
    if (state.root) {
      renderMatches();
      updateHint();
      updateStatus('Datos guardados borrados. Configura Google Sheets o importa un CSV.', false);
      syncControlsVisibility();
    }
  }

  function toggleFormatCommand() {
    if (!state.formatPanel) {
      alert(
        'Formato CSV: columnas Nombre, Apellido y CUIT. Tambien se acepta Nombre completo, Razon Social o Cliente. Separador coma o punto y coma.'
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
      throw new Error('La URL ingresada no es valida.');
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

  function parseRemotePayload(rawText, sourceLabel) {
    const trimmedText = String(rawText || '').trim();
    if (!trimmedText) {
      throw new Error(`El origen ${sourceLabel} no contiene datos.`);
    }

    const entries = parseCsvData(trimmedText);
    if (!entries.length) {
      throw new Error(`No se encontraron registros validos en ${sourceLabel}.`);
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
      return 'Google no devolvio un CSV publico. Publica la hoja o habilita acceso para cualquiera con el enlace.';
    }

    if (
      normalizedText.includes('request access') ||
      normalizedText.includes('solicitar acceso') ||
      normalizedText.includes('you need access') ||
      normalizedText.includes('access denied') ||
      normalizedText.includes('acceso denegado')
    ) {
      return 'El link de Google Sheets no es publico. Usa acceso para cualquiera con el enlace o importa un CSV local.';
    }

    return 'Google devolvio HTML en lugar de CSV. Revisa que el link sea una hoja publica o publicada como CSV.';
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

    const directName = readFirstValue(item, [
      'nombrecompleto',
      'nombreyapellido',
      'displayname',
      'fullname',
      'razonsocial',
      'denominacion',
      'cliente'
    ]);
    const firstName = readFirstValue(item, ['nombre', 'firstname', 'name']);
    const lastName = readFirstValue(item, ['apellido', 'lastname', 'surname']);
    const cuit = String(readFirstValue(item, ['cuit', 'cuil', 'taxid', 'documento']))
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
    return normalizeText([element.textContent, element.value, element.getAttribute('aria-label')].join(' ')).trim();
  }

  function findNextButtonInsertionTarget(inputField) {
    const candidates = ['button', 'input', 'a'].flatMap((selector) => Array.from(document.querySelectorAll(selector)));
    const nextButton = candidates.find((element) => isAfterReference(inputField, element) && nodeText(element) === 'siguiente');
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
    const dataset = readDataset();
    return Boolean(dataset?.entries?.length);
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
      'Usa un link publico de Google Sheets. Cualquiera con acceso al link puede ver esa hoja.';

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
      'CSV esperado: columnas Nombre, Apellido y CUIT. Tambien acepta Nombre completo, Razon Social o Cliente. Separador coma o punto y coma. Para Excel, guardar como CSV.';

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

    title.addEventListener('click', toggleControls);
    searchInput.addEventListener('input', handleSearchInput);
    searchInput.addEventListener('keydown', handleSearchKeydown);
    select.addEventListener('change', handleSelectChange);
    googleButton.addEventListener('click', configureGoogleSheetsCommand);
    importButton.addEventListener('click', importCsvCommand);
    refreshButton.addEventListener('click', () => {
      void handleRefresh();
    });
    clearButton.addEventListener('click', clearConfigurationCommand);
    formatButton.addEventListener('click', toggleFormatCommand);
    saveConfigButton.addEventListener('click', saveGoogleSheetsFromPanel);
    cancelConfigButton.addEventListener('click', hideConfigPanel);
    configInput.addEventListener('keydown', (event) => {
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
    const dataset = readDataset();

    if (config.sourceMode === 'file' && dataset?.fileName) {
      state.hint.textContent = `Origen actual: CSV local (${dataset.fileName}). Para cambios, importa el archivo otra vez.`;
      return;
    }

    if (config.sourceMode === 'url' && config.sourceUrl) {
      try {
        state.hint.textContent = `Origen actual: Google Sheets publico (${new URL(config.sourceUrl).hostname}).`;
      } catch {
        state.hint.textContent = 'La URL configurada necesita revision.';
      }
      return;
    }

    state.hint.textContent = 'Configura un Google Sheets publico o importa un CSV local.';
  }

  function setEntries(entries) {
    state.entries = Array.isArray(entries) ? entries : [];
  }

  function renderMatches() {
    if (!state.select || !state.inputField || !state.searchInput || !state.count) return;

    const searchText = state.searchInput.value.trim();
    const normalizedSearch = normalizeText(searchText);
    const cuitSearch = searchText.replace(/\D/g, '');
    const lastSelectedCuit = readSelectedCuit();

    const matches = state.entries.filter((entry) => {
      if (!searchText) return true;
      const matchesName = normalizedSearch && entry.searchKey.includes(normalizedSearch);
      const matchesCuit = cuitSearch && entry.cuit.includes(cuitSearch);
      return matchesName || matchesCuit;
    });

    state.select.innerHTML = '';

    if (!matches.length) {
      const option = new Option('No se encontraron coincidencias.', '', false, false);
      option.disabled = true;
      state.select.add(option);
      applySelectedCuit('');
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
      applySelectedCuit(state.select.options[state.select.selectedIndex].value);
    } else if (searchText) {
      state.select.selectedIndex = 1;
      applySelectedCuit(state.select.options[1].value);
    } else {
      state.select.selectedIndex = 0;
      applySelectedCuit('');
    }

    state.count.textContent = `${matches.length} coincidencia${matches.length === 1 ? '' : 's'}`;
  }

  function applySelectedCuit(cuit) {
    if (!state.inputField) return;
    const normalizedCuit = String(cuit || '').replace(/\D/g, '');
    state.inputField.value = normalizedCuit;
    if (normalizedCuit) {
      writeSelectedCuit(normalizedCuit);
    } else {
      clearSelectedCuit();
    }
    state.inputField.dispatchEvent(new Event('input', { bubbles: true }));
    state.inputField.dispatchEvent(new Event('change', { bubbles: true }));
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
      updateStatus('Elegi el CSV actualizado para reimportarlo.', false);
      importCsvCommand();
      return;
    }

    await loadEntries({ forceRefresh: true });
  }

  function datasetMatchesConfig(config, dataset) {
    if (!dataset) return false;
    if (config.sourceMode !== dataset.sourceMode) return false;
    if (config.sourceMode === 'url') return config.sourceUrl && config.sourceUrl === dataset.sourceUrl;
    return config.sourceMode === 'file' && Array.isArray(dataset.entries);
  }

  function fetchRemoteText(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        anonymous: true,
        timeout: 20_000,
        headers: {
          'Cache-Control': 'no-cache'
        },
        onload(response) {
          if (response.status >= 200 && response.status < 300) {
            resolve(response.responseText);
            return;
          }
          reject(new Error(`La URL respondio con estado ${response.status}.`));
        },
        onerror() {
          reject(new Error('Fallo la carga remota.'));
        },
        ontimeout() {
          reject(new Error('La carga remota supero el tiempo limite.'));
        }
      });
    });
  }

  async function loadEntries(options) {
    const token = ++state.requestToken;
    let config = readConfig();
    const cachedDataset = readDataset();

    updateHint();

    if (config.sourceMode === 'file') {
      if (!cachedDataset?.entries?.length) {
        setEntries([]);
        renderMatches();
        updateStatus('No hay CSV importado. Usa Importar CSV.', false);
        syncControlsVisibility();
        return;
      }

      setEntries(cachedDataset.entries);
      renderMatches();
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
      updateStatus(error.message || 'La URL configurada no es valida.', true);
      syncControlsVisibility();
      return;
    }

    setLoading(true);
    updateStatus('Actualizando Google Sheets...', false);

    try {
      const remoteText = await fetchRemoteText(config.sourceUrl);
      if (token !== state.requestToken) return;

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
      setEntries(entries);
      renderMatches();
      updateStatus(`Google Sheets actualizado (${entries.length} registros).`, false);
      syncControlsVisibility();
    } catch (error) {
      console.warn(`[${SCRIPT_ID}] Error cargando Google Sheets:`, error);

      if (datasetMatchesConfig(config, cachedDataset) && cachedDataset.entries.length) {
        setEntries(cachedDataset.entries);
        renderMatches();
        updateStatus(
          `Se uso cache anterior (${cachedDataset.entries.length} registros). ${error.message}`,
          true
        );
        syncControlsVisibility();
      } else {
        setEntries([]);
        renderMatches();
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
    return ['', 'text', 'tel', 'search', 'number'].includes(type) && !element.disabled;
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
    const legacyInput = document.getElementById('F1:username');
    if (isUsableTextInput(legacyInput)) return legacyInput;

    const legacyNameInput = document.querySelector('input[name="F1:username"]');
    if (isUsableTextInput(legacyNameInput)) return legacyNameInput;

    const inputs = Array.from(document.querySelectorAll('input'));
    return (
      inputs.find((input) => {
        if (!isUsableTextInput(input)) return false;
        const signature = inputTextSignature(input);
        return signature.includes('cuit') || signature.includes('cuil');
      }) || null
    );
  }

  function destroy() {
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
  }

  function init() {
    if (state.root?.isConnected) return true;

    const inputField = findCuitInput();
    if (!inputField) return false;

    const selectorInsertion = resolveSelectorInsertion(inputField);
    const controlsInsertion = resolveControlsInsertion(inputField);
    if (!selectorInsertion.parent || !controlsInsertion.parent) return false;

    state.inputField = inputField;
    state.style = createStyle();
    buildUi(selectorInsertion, controlsInsertion);
    setEntries([]);
    renderMatches();
    updateHint();
    updateStatus('Cargando configuracion...', false);
    void loadEntries({ forceRefresh: false });
    return true;
  }

  function bootstrap(attempt) {
    if (init()) return;
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

  window.addEventListener(
    'pagehide',
    () => {
      destroy();
    },
    { once: true }
  );
})();
