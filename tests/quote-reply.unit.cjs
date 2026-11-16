/*
 * Pure logic tests, executed without a browser, DOM renderer, sockets, or network.
 * Helpers are extracted from the exact distributed userscript. Fake editors only
 * test control flow; they do not validate browser editing or the real ChatGPT UI.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'chatgpt-quote-reply.user.js'), 'utf8');

function userscriptHeader(text) {
  const match = text.match(/^\/\/ ==UserScript==\r?\n[\s\S]*?^\/\/ ==\/UserScript==\r?$/m);
  assert.ok(match, 'The distribution must contain a complete userscript metadata header.');
  return match[0];
}

function metadataValue(header, key) {
  const pattern = new RegExp(`^//[ \\t]+@${key}[ \\t]+(.+)$`, 'gm');
  const values = [...header.matchAll(pattern)].map(match => match[1].trim());
  assert.equal(values.length, 1, `Expected exactly one @${key} entry.`);
  return values[0];
}

function loadHelper(name, globals = {}) {
  const declaration = new RegExp(`^  (?:async )?function ${name}\\(`, 'm');
  const start = source.search(declaration);
  assert.notEqual(start, -1, `Missing source helper ${name}`);
  const rest = source.slice(start);
  // Source helpers are declarations at indentation level two. Locate their own
  // matching-indentation closing line instead of relying on another helper;
  // quoteSelection is the last declaration, followed by event wiring.
  const close = /^  }\r?$/m.exec(rest);
  assert.ok(close, `Cannot locate the closing line for ${name}`);
  const functionSource = rest.slice(0, close.index + close[0].length).trim();
  return vm.runInNewContext(`(${functionSource})`, globals, { timeout: 1000 });
}

test('distribution: complete userscript parses without executing browser code', () => {
  assert.doesNotThrow(() => new vm.Script(source, { filename: 'chatgpt-quote-reply.user.js' }));
});

test('distribution: version and automatic-update URLs are valid, matching, and free of credentials', () => {
  const header = userscriptHeader(source);
  const version = metadataValue(header, 'version');
  assert.match(version, /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/, 'Version must be an explicit release version.');
  const updateURL = new URL(metadataValue(header, 'updateURL'));
  const downloadURL = new URL(metadataValue(header, 'downloadURL'));
  for (const url of [updateURL, downloadURL]) {
    assert.equal(url.protocol, 'https:');
    assert.equal(url.username, '');
    assert.equal(url.password, '');
    assert.equal(url.search, '', 'Public update URLs must not contain a secret or expiring query token.');
    assert.equal(url.hash, '');
  }
  assert.ok(updateURL.pathname.endsWith('.meta.js'));
  assert.ok(downloadURL.pathname.endsWith('.user.js'));
  assert.equal(updateURL.origin, downloadURL.origin);
  assert.equal(updateURL.pathname.slice(0, -'.meta.js'.length), downloadURL.pathname.slice(0, -'.user.js'.length));
});

test('distribution: .meta.js exactly matches the userscript header and contains no executable payload', () => {
  const metadataPath = path.join(__dirname, '..', 'chatgpt-quote-reply.meta.js');
  const metadata = fs.readFileSync(metadataPath, 'utf8');
  assert.equal(metadata, `${userscriptHeader(source)}\n`);
  assert.doesNotThrow(() => new vm.Script(metadata, { filename: 'chatgpt-quote-reply.meta.js' }));
});

test('distribution: userscript matching is restricted to Dots and has no broader include rule', () => {
  const header = userscriptHeader(source);
  const matches = [...header.matchAll(/^\/\/[ \t]+@match[ \t]+(.+)$/gm)]
    .map(match => match[1].trim()).sort();
  assert.deepEqual(matches, ['https://chatgpt.com/dots', 'https://chatgpt.com/dots/*']);
  assert.doesNotMatch(header, /^\/\/[ \t]+@include[ \t]/m);
});

test('blockquote: preserves multiple lines, empty quoted lines, and code indentation', () => {
  const blockquote = loadHelper('blockquote');
  assert.equal(blockquote('uno\n\n    dos\n\ttres'), '> uno\n>\n>     dos\n> \ttres');
});

test('blockquote: removes only empty outside lines and normalizes CRLF', () => {
  const blockquote = loadHelper('blockquote');
  assert.equal(blockquote(' \r\n  inicio\r\nfin  \r\n\r\n'), '>   inicio\n> fin  ');
});

test('blockquote: Unicode, symbols, and markup-like payloads remain literal text', () => {
  const blockquote = loadHelper('blockquote');
  const input = '<img src=x onerror=alert(1)>\n<script>inert()</script>\nEspaña 🛩️ > 10';
  assert.equal(blockquote(input), '> <img src=x onerror=alert(1)>\n> <script>inert()</script>\n> España 🛩️ > 10');
});

test('routes: accepts only the Dots root and Dots descendants, never home or regular/project chats', () => {
  const location = { pathname: '/dots', search: '', hash: '' };
  const isChatRoute = loadHelper('isChatRoute', { location });
  for (const pathname of ['/dots', '/dots/', '/dots/example', '/dots/example/nested']) {
    location.pathname = pathname;
    assert.equal(isChatRoute(), true, pathname);
  }
  for (const pathname of ['/', '/c/example', '/g/project/c/example', '/settings', '/library', '/plugins', '/dot', '/dotting', '/dots-other', '/dotsSuffix']) {
    location.pathname = pathname;
    assert.equal(isChatRoute(), false, pathname);
  }
  location.pathname = '/dots/example';
  location.search = '?view=chat';
  location.hash = '#message';
  assert.equal(isChatRoute(), true, 'Query strings and fragments do not change a Dots pathname.');
  location.pathname = '/c/example';
  location.search = '?redirect=/dots/example';
  assert.equal(isChatRoute(), false, 'A Dots string inside a query must not enable a regular chat.');
});

test('SPA route sync: hides and clears stale UI when leaving Dots, then safely enables it on return', () => {
  const location = { href: 'http://127.0.0.1/dots/a', pathname: '/dots/a' };
  const cleared = [];
  const state = {
    location,
    knownUrl: location.href,
    isChatRoute: loadHelper('isChatRoute', { location }),
    host: { hidden: false },
    bar: { hidden: false },
    panel: { hidden: false },
    status: { hidden: false },
    pending: { text: 'stale quote' },
    lastEditor: {},
    selectionTimer: 11,
    statusTimer: 22,
    clearTimeout: timer => cleared.push(timer),
  };
  state.hideBar = loadHelper('hideBar', state);
  const syncRoute = loadHelper('syncRoute', state);
  location.pathname = '/c/ordinary-chat';
  location.href = 'http://127.0.0.1/c/ordinary-chat';
  assert.equal(syncRoute(), false);
  assert.equal(state.host.hidden, true);
  assert.equal(state.bar.hidden, true);
  assert.equal(state.panel.hidden, true);
  assert.equal(state.status.hidden, true);
  assert.equal(state.pending, null);
  assert.equal(state.lastEditor, null);
  assert.equal(state.knownUrl, location.href);
  assert.deepEqual(cleared, [11, 22]);

  location.pathname = '/dots/b';
  location.href = 'http://127.0.0.1/dots/b';
  assert.equal(syncRoute(), true);
  assert.equal(state.host.hidden, false);
  assert.equal(state.bar.hidden, true, 'Returning must not restore the old selection toolbar.');
  assert.equal(state.panel.hidden, true);
  assert.equal(state.status.hidden, true);
  assert.equal(state.pending, null);
  assert.equal(state.lastEditor, null);
  assert.equal(state.knownUrl, location.href);
  assert.deepEqual(cleared, [11, 22, 11, 22]);
});

test('snapshot: rejects changed route, changed selected text, and detached source nodes', () => {
  const location = { href: 'http://127.0.0.1/dots/a', pathname: '/dots/a' };
  const isChatRoute = loadHelper('isChatRoute', { location });
  const snapshotStillValid = loadHelper('snapshotStillValid', { location, isChatRoute });
  const startContainer = { isConnected: true };
  const endContainer = { isConnected: true };
  let rangeValue = 'texto';
  const snapshot = {
    url: location.href, rangeText: 'texto',
    range: { startContainer, endContainer, toString: () => rangeValue },
  };
  assert.equal(snapshotStillValid(snapshot), true);
  location.href = 'http://127.0.0.1/dots/b';
  assert.equal(snapshotStillValid(snapshot), false);
  location.href = snapshot.url;
  rangeValue = 'otro';
  assert.equal(snapshotStillValid(snapshot), false);
  rangeValue = snapshot.rangeText;
  startContainer.isConnected = false;
  assert.equal(snapshotStillValid(snapshot), false);
  startContainer.isConnected = true;
  endContainer.isConnected = false;
  assert.equal(snapshotStillValid(snapshot), false);
  assert.equal(Boolean(snapshotStillValid(null)), false);
});

test('snapshot: a matching URL and intact selection are insufficient outside Dots', () => {
  const location = { href: '', pathname: '' };
  const isChatRoute = loadHelper('isChatRoute', { location });
  const snapshotStillValid = loadHelper('snapshotStillValid', { location, isChatRoute });
  for (const pathname of ['/', '/c/example', '/g/project/c/example', '/dots-other']) {
    location.pathname = pathname;
    location.href = `http://127.0.0.1${pathname}`;
    const snapshot = {
      url: location.href, rangeText: 'selección intacta',
      range: {
        startContainer: { isConnected: true }, endContainer: { isConnected: true },
        toString: () => 'selección intacta',
      },
    };
    assert.equal(Boolean(snapshotStillValid(snapshot)), false, pathname);
  }
});

function findWith(candidates, lastEditor = null) {
  return loadHelper('findEditor', {
    candidateEditors: () => candidates,
    editorScore: editor => editor.score,
    lastEditor,
  })();
}

test('editor choice: a unique strong candidate beats generic candidates', () => {
  const strong = { score: 100 }, generic = { score: 50 };
  assert.equal(findWith([generic, strong]), strong);
});

test('editor choice: ambiguous strong candidates fail closed unless the user focused one', () => {
  const first = { score: 100 }, second = { score: 90 };
  assert.equal(findWith([first, second]), null);
  assert.equal(findWith([first, second], second), second);
});

test('editor choice: unique generic main editor is allowed, two equally labeled editors are not', () => {
  const plain = { score: 20 }, labeled1 = { score: 50 }, labeled2 = { score: 50 };
  assert.equal(findWith([plain]), plain);
  assert.equal(findWith([labeled1, labeled2]), null);
  assert.equal(findWith([plain, labeled1]), labeled1);
  assert.equal(findWith([]), null);
});

test('editor choice: a stale last-editor reference is never used when absent from candidates', () => {
  const stale = { score: 100 }, current = { score: 20 };
  assert.equal(findWith([current], stale), current);
  assert.equal(findWith([], stale), null);
});

class FakeInputEvent {
  constructor(type, options = {}) { Object.assign(this, options); this.type = type; this.defaultPrevented = false; }
  preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
}

class FakeEditor {
  constructor(text = '') {
    this.listeners = new Map();
    this.isConnected = true;
    this.innerText = text;
    this.innerHTML = `<p>${text}</p>`;
    this.focused = false;
    this.events = [];
    this.attributes = {};
    this.isContentEditable = true;
    this.rects = [{ width: 400, height: 80 }];
    this.computedStyle = { display: 'block', visibility: 'visible', opacity: '1' };
    this.parentElement = null;
    this.hiddenAncestor = null;
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  dispatchEvent(event) {
    this.events.push(event);
    for (const fn of this.listeners.get(event.type) ?? []) fn(event);
    return !event.defaultPrevented;
  }
  focus() { this.focused = true; this.ownerDocument.activeElement = this; this.onFocus?.(); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  getClientRects() { return this.rects; }
  closest() { return this.hiddenAncestor; }
  setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
}

class FakeTextarea extends FakeEditor {
  constructor(value = '') { super(value); this.tagName = 'TEXTAREA'; this._value = value; this.maxLength = -1; this.isContentEditable = false; }
  get value() { return this._value; }
  set value(value) { this._value = value; }
}

function insertionHarness(editor, mode = 'native', afterRender = () => {}) {
  const calls = [];
  const editorText = loadHelper('editorText');
  const comparable = loadHelper('comparable');
  const isVisible = loadHelper('isVisible', { getComputedStyle: node => node.computedStyle });
  const document = {
    activeElement: null,
    createRange: () => ({
      selectNodeContents(node) { calls.push(['selectNodeContents', node]); },
      collapse(toStart) { calls.push(['collapse', toStart]); },
    }),
    execCommand(command, showUI, addition) {
      calls.push(['execCommand', command, showUI, addition]);
      if (mode === 'throw') throw new Error('Editing unavailable');
      if (mode === 'unsupported') return false;
      if (mode === 'veto') {
        const event = new FakeInputEvent('beforeinput', {
          inputType: 'insertText', data: addition, bubbles: true, cancelable: true,
        });
        editor.dispatchEvent(event);
        return false;
      }
      if (editor.tagName === 'TEXTAREA') editor.value += addition;
      else { editor.innerText += addition; editor.innerHTML += `<!--appended-->${addition}`; }
      if (mode === 'native') editor.dispatchEvent(new FakeInputEvent('input', { inputType: 'insertText', data: addition }));
      return true;
    },
  };
  editor.ownerDocument = document;
  const location = { href: 'http://127.0.0.1/dots/a' };
  if (mode === 'missing') delete document.execCommand;
  const selection = {
    removeAllRanges() { calls.push(['removeAllRanges']); },
    addRange(range) { calls.push(['addRange', range]); },
  };
  const appendQuote = loadHelper('appendQuote', {
    editorText, comparable, isVisible, document, location,
    window: { getSelection: () => selection },
    HTMLTextAreaElement: FakeTextarea,
    InputEvent: FakeInputEvent,
    setTimeout(callback) { afterRender(); callback(); },
  });
  return { appendQuote, calls, document, location };
}

test('comparison logic: normalizes rendering whitespace without joining words', () => {
  const comparable = loadHelper('comparable');
  assert.equal(comparable('  una\n\n cita  '), 'una cita');
  assert.notEqual(comparable('una cita'), comparable('unacita'));
});

test('insertion logic: does not confirm success after navigation during acknowledgement', async () => {
  const editor = new FakeTextarea('previo');
  let harness;
  harness = insertionHarness(editor, 'native', () => { harness.location.href = 'http://127.0.0.1/dots/b'; });
  const result = await harness.appendQuote(editor, '> cita');
  assert.equal(result.ok, false);
  assert.equal(result.changed, true);
});

test('insertion logic: native textarea path preserves draft prefix and does not emit duplicate input', async () => {
  const editor = new FakeTextarea('  previo  \n');
  const { appendQuote } = insertionHarness(editor);
  const result = await appendQuote(editor, '> cita');
  assert.equal(editor.value, '  previo  \n\n\n> cita\n\n');
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(editor.events.filter(e => e.type === 'input').length, 1);
});

test('insertion logic: textarea fallback uses its prototype setter and emits input', async () => {
  const editor = new FakeTextarea('previo');
  const { appendQuote } = insertionHarness(editor, 'unsupported');
  const result = await appendQuote(editor, '> cita');
  assert.equal(editor.value, 'previo\n\n> cita\n\n');
  assert.equal(result.ok, true);
  assert.equal(editor.selectionStart, editor.value.length);
  assert.equal(editor.events.filter(e => e.type === 'input').length, 1);
});

test('insertion logic: missing editing command does not directly rewrite rich HTML', async () => {
  const editor = new FakeEditor('previo');
  editor.tagName = 'DIV';
  const beforeMarkup = editor.innerHTML;
  const { appendQuote } = insertionHarness(editor, 'missing');
  const result = await appendQuote(editor, '> cita');
  assert.equal(result.ok, false);
  assert.equal(result.changed, false);
  assert.equal(editor.innerHTML, beforeMarkup);
  assert.equal(editor.innerText, 'previo');
});

test('insertion logic: rich editor path collapses at end and appends via native editing', async () => {
  const editor = new FakeEditor('previo');
  editor.tagName = 'DIV';
  const { appendQuote, calls } = insertionHarness(editor);
  const result = await appendQuote(editor, '> cita');
  assert.equal(result.ok, true);
  assert.equal(editor.innerText, 'previo\n\n> cita\n\n');
  assert.ok(calls.some(call => call[0] === 'collapse' && call[1] === false));
  assert.ok(calls.some(call => call[0] === 'execCommand' && call[1] === 'insertText'));
});

test('insertion logic: a rejected controlled-editor update is not reported successful', async () => {
  const editor = new FakeTextarea('previo');
  const { appendQuote } = insertionHarness(editor, 'native', () => { editor.value = 'previo'; });
  const result = await appendQuote(editor, '> cita');
  assert.equal(result.ok, false);
  assert.equal(result.changed, false);
});

test('insertion logic: detached editor is not reported successful', async () => {
  const editor = new FakeTextarea();
  const { appendQuote } = insertionHarness(editor, 'native', () => { editor.isConnected = false; });
  const result = await appendQuote(editor, '> cita');
  assert.equal(result.ok, false);
});

test('insertion logic: an editing exception leaves textarea unchanged instead of forcing a fallback', async () => {
  const editor = new FakeTextarea('previo');
  const { appendQuote } = insertionHarness(editor, 'throw');
  const result = await appendQuote(editor, '> cita');
  assert.equal(editor.value, 'previo');
  assert.equal(result.ok, false);
});

test('insertion logic: an explicit beforeinput veto must not be bypassed by a textarea fallback', async () => {
  const editor = new FakeTextarea('previo');
  editor.addEventListener('beforeinput', event => event.preventDefault());
  const { appendQuote } = insertionHarness(editor, 'veto');
  const result = await appendQuote(editor, '> cita');
  assert.equal(editor.value, 'previo');
  assert.equal(result.ok, false);
  assert.equal(editor.events.filter(e => e.type === 'input').length, 0);
});

test('insertion logic: maxlength refuses the complete quote without truncating or changing the draft', async () => {
  const editor = new FakeTextarea('previo');
  editor.maxLength = 10;
  const { appendQuote, calls } = insertionHarness(editor);
  const result = await appendQuote(editor, '> cita larga');
  assert.equal(result.ok, false);
  assert.equal(editor.value, 'previo');
  assert.equal(calls.length, 0);
});

test('insertion logic: focus navigation aborts before editing', async () => {
  const editor = new FakeTextarea('previo');
  const { appendQuote, calls, location } = insertionHarness(editor);
  editor.onFocus = () => { location.href = 'http://127.0.0.1/dots/b'; };
  const result = await appendQuote(editor, '> cita');
  assert.equal(result.ok, false);
  assert.equal(editor.value, 'previo');
  assert.equal(calls.length, 0);
});

test('insertion logic: redirected focus aborts rather than typing into an unrelated editor', async () => {
  const editor = new FakeTextarea('previo');
  const { appendQuote, calls, document } = insertionHarness(editor);
  editor.onFocus = () => { document.activeElement = {}; };
  const result = await appendQuote(editor, '> cita');
  assert.equal(result.ok, false);
  assert.equal(editor.value, 'previo');
  assert.equal(calls.length, 0);
});

test('insertion logic: a beforeinput handler modifying the draft is never overwritten by fallback', async () => {
  const editor = new FakeTextarea('previo');
  editor.addEventListener('beforeinput', () => { editor.value = 'modificado por editor'; });
  const { appendQuote } = insertionHarness(editor, 'unsupported');
  const result = await appendQuote(editor, '> cita');
  assert.equal(editor.value, 'modificado por editor');
  assert.equal(result.ok, false);
});

test('visibility logic: rejects zero-area rectangles and accepts a genuine positive rectangle', () => {
  const isVisible = loadHelper('isVisible', { getComputedStyle: node => node.computedStyle });
  const node = new FakeEditor();
  assert.equal(isVisible(node), true);
  for (const rects of [[], [{ width: 0, height: 0 }], [{ width: 0, height: 20 }], [{ width: 20, height: 0 }]]) {
    node.rects = rects;
    assert.equal(isVisible(node), false);
  }
  node.rects = [{ width: 0, height: 0 }, { width: 20, height: 20 }];
  assert.equal(isVisible(node), true);
});

test('visibility logic: rejects opacity zero on either the editor or an ancestor', () => {
  const isVisible = loadHelper('isVisible', { getComputedStyle: node => node.computedStyle });
  const node = new FakeEditor();
  node.computedStyle.opacity = '0';
  assert.equal(isVisible(node), false);
  node.computedStyle.opacity = '1';
  node.parentElement = { computedStyle: { opacity: '0' }, parentElement: null };
  assert.equal(isVisible(node), false);
  node.parentElement.computedStyle.opacity = '0.5';
  assert.equal(isVisible(node), true);
});

test('visibility logic: rejects disconnection, hidden ancestors, and hidden or collapsed CSS', () => {
  const isVisible = loadHelper('isVisible', { getComputedStyle: node => node.computedStyle });
  const node = new FakeEditor();
  node.isConnected = false;
  assert.equal(isVisible(node), false);
  node.isConnected = true;
  node.hiddenAncestor = {};
  assert.equal(isVisible(node), false);
  node.hiddenAncestor = null;
  node.computedStyle.display = 'none';
  assert.equal(isVisible(node), false);
  node.computedStyle.display = 'block';
  for (const visibility of ['hidden', 'collapse']) {
    node.computedStyle.visibility = visibility;
    assert.equal(isVisible(node), false);
  }
});

test('insertion logic: reads the latest draft after a focus handler has changed it', async () => {
  const editor = new FakeTextarea('draft before focus');
  const { appendQuote } = insertionHarness(editor);
  editor.onFocus = () => { editor.value = 'draft updated on focus'; };
  const result = await appendQuote(editor, '> cita');
  assert.equal(editor.value, 'draft updated on focus\n\n> cita\n\n');
  assert.equal(result.ok, true);
});

test('insertion logic: does not retry a native input that a controlled editor reverted synchronously', async () => {
  const editor = new FakeTextarea('previo');
  editor.addEventListener('input', () => { editor.value = 'previo'; });
  const { appendQuote, calls } = insertionHarness(editor);
  const result = await appendQuote(editor, '> cita');
  assert.equal(editor.value, 'previo');
  assert.equal(result.ok, false);
  assert.equal(result.changed, false);
  assert.equal(editor.events.filter(event => event.type === 'input').length, 1);
  assert.equal(editor.events.filter(event => event.type === 'beforeinput').length, 0);
  assert.equal(calls.filter(call => call[0] === 'execCommand').length, 1);
});

test('insertion logic: a rich editor that becomes noneditable on focus is not modified', async () => {
  const editor = new FakeEditor('previo');
  editor.tagName = 'DIV';
  const { appendQuote, calls } = insertionHarness(editor);
  editor.onFocus = () => { editor.isContentEditable = false; };
  const result = await appendQuote(editor, '> cita');
  assert.equal(result.ok, false);
  assert.equal(editor.innerText, 'previo');
  assert.equal(calls.length, 0);
});

function quoteActionHarness(options = {}) {
  const editor = {};
  const location = {
    pathname: options.pathname ?? '/dots/fixture',
    href: `http://127.0.0.1${options.pathname ?? '/dots/fixture'}`,
  };
  const isChatRoute = loadHelper('isChatRoute', { location });
  const validateSnapshot = loadHelper('snapshotStillValid', { location, isChatRoute });
  const snapshot = {
    text: 'Fragmento seleccionado', rangeText: 'Fragmento seleccionado', url: location.href,
    range: {
      startContainer: { isConnected: true }, endContainer: { isConnected: true },
      toString: () => 'Fragmento seleccionado',
    },
  };
  const calls = { notifications: [], copyPanels: [], insertions: [], hidden: 0 };
  const state = {
    busy: false,
    lastEditor: null,
    MAX_SELECTION: 50000,
    quoteButton: { disabled: false },
    location,
    isChatRoute,
    snapshotStillValid: current => options.valid !== false && validateSnapshot(current),
    blockquote: loadHelper('blockquote'),
    findEditor: () => options.missingEditor ? null : editor,
    hideBar: () => { calls.hidden++; },
    notify: message => calls.notifications.push(message),
    showCopyPanel: (quote, reason) => calls.copyPanels.push({ quote, reason }),
    appendQuote: async (target, quote) => {
      calls.insertions.push({ target, quote });
      if (options.changedRoute) {
        location.href = 'http://127.0.0.1/dots/different';
        location.pathname = '/dots/different';
      }
      if (options.throwError) throw new Error('Simulated unsupported editor');
      return options.result ?? { ok: true, changed: true };
    },
  };
  const quoteSelection = loadHelper('quoteSelection', state);
  return { quoteSelection, snapshot, state, calls, editor };
}

test('quote action: successful insertion is silent and does not call notify or open a copy panel', async () => {
  const { quoteSelection, snapshot, state, calls, editor } = quoteActionHarness();
  await quoteSelection(snapshot);
  assert.equal(calls.insertions.length, 1);
  assert.equal(calls.insertions[0].target, editor);
  assert.equal(calls.insertions[0].quote, '> Fragmento seleccionado');
  assert.deepEqual(calls.notifications, [], 'A successful quote must not display the removed success toast.');
  assert.deepEqual(calls.copyPanels, []);
  assert.equal(state.lastEditor, editor);
  assert.equal(state.busy, false);
  assert.equal(state.quoteButton.disabled, false);
});

test('quote action: never inserts in home, ordinary chats, projects, or lookalike paths', async () => {
  for (const pathname of ['/', '/c/example', '/g/project/c/example', '/dots-other']) {
    const { quoteSelection, snapshot, calls } = quoteActionHarness({ pathname });
    await quoteSelection(snapshot);
    assert.equal(calls.insertions.length, 0, pathname);
    assert.equal(calls.copyPanels.length, 0, pathname);
  }
});

test('quote action: invalid selection still produces an actionable error without inserting', async () => {
  const { quoteSelection, snapshot, calls } = quoteActionHarness({ valid: false });
  await quoteSelection(snapshot);
  assert.equal(calls.insertions.length, 0);
  assert.equal(calls.notifications.length, 1);
  assert.match(calls.notifications[0], /selecci|selecciona/i);
});

test('quote action: oversized selection still warns rather than truncating or inserting', async () => {
  const { quoteSelection, snapshot, state, calls } = quoteActionHarness();
  snapshot.text = 'x'.repeat(state.MAX_SELECTION + 1);
  await quoteSelection(snapshot);
  assert.equal(calls.insertions.length, 0);
  assert.equal(calls.notifications.length, 1);
  assert.match(calls.notifications[0], /50[.,]000|largo|corto|supera/i);
});

test('quote action: missing editor retains the manual-copy fallback', async () => {
  const { quoteSelection, snapshot, calls } = quoteActionHarness({ missingEditor: true });
  await quoteSelection(snapshot);
  assert.equal(calls.insertions.length, 0);
  assert.equal(calls.copyPanels.length, 1);
  assert.match(calls.copyPanels[0].reason, /editor/i);
  assert.equal(calls.copyPanels[0].quote, '> Fragmento seleccionado');
});

test('quote action: unconfirmed partial insertion retains the duplicate-warning fallback', async () => {
  const { quoteSelection, snapshot, state, calls } = quoteActionHarness({ result: { ok: false, changed: true } });
  await quoteSelection(snapshot);
  assert.equal(calls.copyPanels.length, 1);
  assert.match(calls.copyPanels[0].reason, /duplicado|revisa/i);
  assert.equal(state.busy, false);
  assert.equal(state.quoteButton.disabled, false);
});

test('quote action: rejected insertion retains an explanation and a copyable quote', async () => {
  const { quoteSelection, snapshot, calls } = quoteActionHarness({ result: { ok: false, changed: false } });
  await quoteSelection(snapshot);
  assert.equal(calls.copyPanels.length, 1);
  assert.match(calls.copyPanels[0].reason, /no aceptó|no se ha modificado/i);
  assert.equal(calls.copyPanels[0].quote, '> Fragmento seleccionado');
});

test('quote action: insertion exceptions retain the manual fallback and restore control state', async () => {
  const { quoteSelection, snapshot, state, calls } = quoteActionHarness({ throwError: true });
  await quoteSelection(snapshot);
  assert.equal(calls.copyPanels.length, 1);
  assert.match(calls.copyPanels[0].reason, /confirmar|revisa/i);
  assert.equal(state.busy, false);
  assert.equal(state.quoteButton.disabled, false);
});

test('quote action: route changes during insertion still produce a warning', async () => {
  const { quoteSelection, snapshot, state, calls } = quoteActionHarness({ changedRoute: true });
  await quoteSelection(snapshot);
  assert.equal(calls.notifications.length, 1);
  assert.match(calls.notifications[0], /conversación.*cambiado/i);
  assert.equal(state.busy, false);
  assert.equal(state.quoteButton.disabled, false);
});
