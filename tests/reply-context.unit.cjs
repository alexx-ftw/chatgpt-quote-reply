/*
 * Offline context-routing tests against helpers extracted from the distributed
 * userscript. The small tree/selector fake below is NOT a browser DOM and does
 * not establish that ChatGPT/Dots currently uses these structures. No sockets,
 * page navigation, credentials, browser process, or network are involved.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'chatgpt-quote-reply.user.js'), 'utf8');

function helperSource(name) {
  const start = source.search(new RegExp(`^  (?:async )?function ${name}\\(`, 'm'));
  assert.notEqual(start, -1, `Missing source helper ${name}`);
  const rest = source.slice(start);
  const close = /^  }\r?$/m.exec(rest);
  assert.ok(close, `Missing helper terminator for ${name}`);
  return rest.slice(0, close.index + close[0].length).trim();
}

function matchesOne(node, selector) {
  let rest = selector.trim();
  const tag = /^[a-z][\w-]*/i.exec(rest);
  if (tag) {
    if (node.tagName !== tag[0].toUpperCase()) return false;
    rest = rest.slice(tag[0].length);
  }
  while (rest) {
    const idOrClass = /^([.#])([\w-]+)/.exec(rest);
    if (idOrClass) {
      const matched = idOrClass[1] === '#'
        ? node.id === idOrClass[2]
        : (node.getAttribute('class') || '').split(/\s+/).includes(idOrClass[2]);
      if (!matched) return false;
      rest = rest.slice(idOrClass[0].length);
      continue;
    }
    const attribute = /^\[([\w:-]+)(?:([*^$]?=)"([^"]*)")?\]/.exec(rest);
    assert.ok(attribute, `Unsupported selector in fixture fake: ${selector}`);
    const actual = node.getAttribute(attribute[1]);
    if (actual === null) return false;
    const expected = attribute[3];
    const operator = attribute[2];
    if (operator === '=' && actual !== expected) return false;
    if (operator === '*=' && !actual.includes(expected)) return false;
    if (operator === '^=' && !actual.startsWith(expected)) return false;
    if (operator === '$=' && !actual.endsWith(expected)) return false;
    rest = rest.slice(attribute[0].length);
  }
  return true;
}

class Element {
  constructor(tagName = 'div', attributes = {}) {
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.attributes = { ...attributes };
    this.parentElement = null;
    this.children = [];
    this.disabled = false;
    this.readOnly = false;
    this.style = { display: 'block', visibility: 'visible', opacity: '1' };
    this.rect = { left: 20, top: 20, right: 220, bottom: 40, width: 200, height: 20 };
  }
  get id() { return this.getAttribute('id') || ''; }
  get isConnected() {
    let root = this;
    while (root.parentElement) root = root.parentElement;
    return root.documentRoot === true;
  }
  get isContentEditable() {
    const value = this.getAttribute('contenteditable');
    if (value === '' || value === 'true' || value === 'plaintext-only') return true;
    if (value === 'false') return false;
    return this.parentElement?.isContentEditable || false;
  }
  get textContent() { return this.children.map(child => child.textContent).join(''); }
  getAttribute(name) { return Object.hasOwn(this.attributes, name) ? String(this.attributes[name]) : null; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  append(...nodes) {
    for (const node of nodes) {
      node.remove();
      this.children.push(node);
      node.parentElement = this;
    }
    return this;
  }
  remove() {
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter(child => child !== this);
      this.parentElement = null;
    }
  }
  contains(node) {
    for (let current = node; current; current = current.parentElement) if (current === this) return true;
    return false;
  }
  matches(selectors) { return selectors.split(',').some(selector => matchesOne(this, selector)); }
  closest(selectors) {
    for (let current = this; current; current = current.parentElement) {
      if (current.matches(selectors)) return current;
    }
    return null;
  }
  querySelectorAll(selectors) {
    const result = [];
    for (const child of this.children) {
      if (child.nodeType !== 1) continue;
      if (child.matches(selectors)) result.push(child);
      result.push(...child.querySelectorAll(selectors));
    }
    return result;
  }
  getClientRects() {
    if (!this.isConnected) return [];
    for (let current = this; current; current = current.parentElement) {
      if (current.getAttribute('hidden') !== null || current.style.display === 'none') return [];
    }
    return [this.rect];
  }
}

class TextNode {
  constructor(text) { this.nodeType = 3; this.textContent = text; this.parentElement = null; }
  get isConnected() { return !!this.parentElement?.isConnected; }
  remove() {
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter(child => child !== this);
      this.parentElement = null;
    }
  }
}

function el(tag, attrs, ...children) { return new Element(tag, attrs).append(...children); }
function message(text = 'Un fragmento de prueba.') {
  const textNode = new TextNode(text);
  const paragraph = el('p', {}, textNode);
  const root = el('article', { 'data-message-author-role': 'assistant' }, paragraph);
  return { root, paragraph, textNode };
}
function composer(attributes = {}, wrapperAttributes = {}) {
  const editor = el('div', { contenteditable: 'true', 'aria-label': 'Reply', ...attributes });
  const wrapper = el('div', wrapperAttributes, editor);
  return { editor, wrapper };
}

function environment() {
  const body = el('body', {});
  body.documentRoot = true;
  const document = { body, querySelectorAll: selector => body.querySelectorAll(selector) };
  const host = el('div', { id: 'fixture-overlay' });
  body.append(host);
  let selection = null;
  const context = vm.createContext({
    document, host,
    location: { pathname: '/dots/offline-fixture', href: 'http://127.0.0.1/dots/offline-fixture' },
    Node: { ELEMENT_NODE: 1 },
    getComputedStyle: node => node.style,
    window: { getSelection: () => selection },
    lastEditor: null,
  });
  const constantStart = source.indexOf('  const ROOT_ID');
  const constantEnd = source.indexOf('\n  if (!', constantStart);
  assert.ok(constantStart !== -1 && constantEnd > constantStart, 'Unable to locate source selector constants.');
  vm.runInContext(source.slice(constantStart, constantEnd), context, { timeout: 1000 });
  for (const name of [
    'asElement', 'isChatRoute', 'isVisible', 'validSelectionEnd', 'conversationBoundary',
    'isReplyComposer', 'structuralEditors', 'editorScope', 'selectionScope', 'candidateEditors',
    'editorScore', 'findEditor', 'selectionSnapshot', 'snapshotContextValid', 'snapshotStillValid',
  ]) context[name] = vm.runInContext(`(${helperSource(name)})`, context, { timeout: 1000 });

  function select(startNode, endNode = startNode, text = 'Un fragmento de prueba.') {
    const range = {
      startContainer: startNode, endContainer: endNode,
      toString: () => text,
      getClientRects: () => [{ left: 20, top: 20, right: 220, bottom: 40, width: 200, height: 20 }],
      getBoundingClientRect: () => ({ left: 20, top: 20, right: 220, bottom: 40, width: 200, height: 20 }),
      cloneRange() { return { ...this }; },
    };
    selection = { isCollapsed: false, rangeCount: 1, getRangeAt: () => range, toString: () => text };
    return context.selectionSnapshot();
  }
  return { body, context, select };
}

function mainAndReply({ tag = 'aside', panelAttributes = {}, noReplyEditor = false, inlineInMessage = false } = {}) {
  const env = environment();
  const mainMessage = message('Mensaje principal.');
  const mainEditor = el('textarea', { id: 'prompt-textarea', 'aria-label': 'Mensaje' });
  const mainComposer = el('div', { 'data-testid': 'main-composer' }, mainEditor);
  const main = el('main', {}, mainMessage.root, mainComposer);
  env.body.append(main);
  const replyMessage = message('Mensaje del hilo.');
  const replyLog = el('div', { role: 'log' }, replyMessage.root);
  const replyComposer = composer({}, { 'data-testid': 'reply-composer' });
  const replyRoot = el(tag, panelAttributes, replyLog);
  if (!noReplyEditor) replyRoot.append(replyComposer.wrapper);
  (inlineInMessage ? mainMessage.root : main).append(replyRoot);
  return { ...env, main, mainMessage, mainEditor, mainComposer, replyRoot, replyLog, replyMessage,
    replyEditor: replyComposer.editor, replyComposer: replyComposer.wrapper };
}

test('reply context: panel boundary wins over the outer main and a nested log', () => {
  const f = mainAndReply();
  assert.equal(f.context.conversationBoundary(f.replyMessage.textNode), f.replyRoot);
  assert.equal(f.context.conversationBoundary(f.replyEditor), f.replyRoot);
  assert.equal(f.context.conversationBoundary(f.mainMessage.textNode), f.main);
  assert.equal(f.context.conversationBoundary(f.body), f.body);
});

test('reply context: sibling log and composer share the reply container', () => {
  const f = mainAndReply({ tag: 'dialog', panelAttributes: { open: '' } });
  assert.equal(f.context.editorScope(f.replyEditor), f.replyRoot);
  assert.notEqual(f.context.editorScope(f.replyEditor), f.replyLog);
  const snapshot = f.select(f.replyMessage.textNode);
  assert.ok(snapshot);
  assert.equal(snapshot.boundary, f.replyRoot);
  assert.equal(snapshot.scope, f.replyRoot);
  assert.equal(snapshot.editor, f.replyEditor);
});

test('reply context: a strong main composer never outranks the selected reply editor', () => {
  const f = mainAndReply();
  f.replyComposer.removeAttribute('data-testid');
  f.replyEditor.removeAttribute('aria-label');
  assert.equal(f.context.editorScore(f.mainEditor), 100);
  assert.equal(f.context.editorScore(f.replyEditor), 20);
  const snapshot = f.select(f.replyMessage.textNode);
  assert.equal(snapshot.editor, f.replyEditor);
  assert.equal(f.context.findEditor(snapshot), f.replyEditor);
});

test('reply context: main focus history is ignored for a selected reply', () => {
  const f = mainAndReply();
  f.context.lastEditor = f.mainEditor;
  assert.equal(f.select(f.replyMessage.textNode).editor, f.replyEditor);
});

test('reply context: reply focus history is ignored for a selected main-chat message', () => {
  const f = mainAndReply();
  f.context.lastEditor = f.replyEditor;
  const snapshot = f.select(f.mainMessage.textNode);
  assert.equal(snapshot.boundary, f.main);
  assert.equal(snapshot.scope, f.main);
  assert.equal(snapshot.editor, f.mainEditor);
});

test('reply context: a generic inline wrapper isolates its own messages and composer', () => {
  const f = mainAndReply({ tag: 'div' });
  assert.equal(f.context.conversationBoundary(f.replyEditor), f.main);
  assert.equal(f.context.editorScope(f.replyEditor), f.replyRoot);
  f.context.lastEditor = f.mainEditor;
  const snapshot = f.select(f.replyMessage.textNode);
  assert.equal(snapshot.boundary, f.main);
  assert.equal(snapshot.scope, f.replyRoot);
  assert.equal(snapshot.editor, f.replyEditor);
  assert.equal(f.select(f.mainMessage.textNode).editor, f.mainEditor);
});

test('reply context: inline reply nested in a message permits its explicitly labeled composer only', () => {
  const f = mainAndReply({ tag: 'div', inlineInMessage: true });
  assert.equal(f.context.isReplyComposer(f.replyEditor), true);
  assert.ok(f.context.structuralEditors().includes(f.replyEditor));
  assert.equal(f.select(f.replyMessage.textNode).editor, f.replyEditor);
  const messageEditor = el('div', { contenteditable: 'true', 'aria-label': 'Edit message' });
  f.mainMessage.root.append(messageEditor);
  assert.equal(f.context.isReplyComposer(messageEditor), false);
  assert.ok(!f.context.structuralEditors().includes(messageEditor));
});

for (const [attribute, value] of [
  ['placeholder', 'Reply...'],
  ['data-testid', 'reply_composer'],
  ['data-testid', 'replyComposer'],
]) {
  test(`reply context: explicit ${attribute}=${value} identifies an inline reply composer`, () => {
    const f = mainAndReply({ tag: 'div', inlineInMessage: true });
    f.replyEditor.removeAttribute('aria-label');
    f.replyComposer.removeAttribute('data-testid');
    f.replyEditor.setAttribute(attribute, value);
    assert.equal(f.context.isReplyComposer(f.replyEditor), true);
    assert.ok(f.context.structuralEditors().includes(f.replyEditor));
    const snapshot = f.select(f.replyMessage.textNode);
    assert.equal(snapshot.scope, f.replyRoot);
    assert.equal(snapshot.editor, f.replyEditor);
    assert.equal(f.context.snapshotStillValid(snapshot), true);
  });
}

test('reply context: structural editors exclude navigation, alerts, and nested editable fragments', () => {
  const f = mainAndReply();
  const navEditor = el('textarea', { 'aria-label': 'Reply' });
  const alertEditor = el('textarea', { 'aria-label': 'Reply' });
  const nestedEditor = el('div', { contenteditable: 'true', 'aria-label': 'Reply' });
  f.main.append(el('nav', {}, navEditor), el('div', { role: 'alertdialog' }, alertEditor));
  f.replyEditor.append(nestedEditor);
  const editors = f.context.structuralEditors();
  assert.ok(editors.includes(f.replyEditor));
  assert.ok(!editors.includes(navEditor));
  assert.ok(!editors.includes(alertEditor));
  assert.ok(!editors.includes(nestedEditor));
});

test('reply context: an aside without an editor cannot fall back to the main composer', () => {
  const f = mainAndReply({ noReplyEditor: true });
  f.context.lastEditor = f.mainEditor;
  const snapshot = f.select(f.replyMessage.textNode);
  assert.ok(snapshot);
  assert.equal(snapshot.scope, f.replyRoot);
  assert.equal(snapshot.editor, null);
  assert.equal(f.context.findEditor(snapshot), null);
});

test('reply context: nested inline messages without an editor cannot fall back to main', () => {
  const f = mainAndReply({ tag: 'div', inlineInMessage: true, noReplyEditor: true });
  f.context.lastEditor = f.mainEditor;
  const snapshot = f.select(f.replyMessage.textNode);
  assert.ok(snapshot);
  assert.equal(snapshot.boundary, f.main);
  assert.equal(snapshot.scope, f.replyLog);
  assert.equal(snapshot.editor, null);
  assert.equal(f.context.findEditor(snapshot), null);
  assert.equal(f.context.snapshotStillValid(snapshot), true);
  assert.equal(f.select(f.mainMessage.textNode).editor, f.mainEditor);
});

for (const signal of ['textbox-role', 'composer-wrapper', 'own-reply-label']) {
  test(`reply context: contenteditable=false with ${signal} retains inline scope without a destination`, () => {
    const f = mainAndReply({ tag: 'div' });
    f.replyEditor.setAttribute('contenteditable', 'false');
    f.replyEditor.removeAttribute('aria-label');
    f.replyComposer.removeAttribute('data-testid');
    if (signal === 'textbox-role') f.replyEditor.setAttribute('role', 'textbox');
    if (signal === 'composer-wrapper') f.replyComposer.setAttribute('data-testid', 'reply-composer');
    if (signal === 'own-reply-label') f.replyEditor.setAttribute('aria-label', 'Reply...');
    f.context.lastEditor = f.mainEditor;
    assert.ok(f.context.structuralEditors().includes(f.replyEditor));
    assert.ok(!f.context.candidateEditors().includes(f.replyEditor));
    const snapshot = f.select(f.replyMessage.textNode);
    assert.ok(snapshot);
    assert.equal(snapshot.scope, f.replyRoot);
    assert.equal(snapshot.editor, null);
    assert.equal(f.context.findEditor(snapshot), null);
  });
}

for (const unavailable of ['hidden', 'disabled', 'readonly', 'aria-disabled']) {
  test(`reply context: ${unavailable} inline editor keeps its local scope without fallback`, () => {
    const f = mainAndReply({ tag: 'div' });
    if (unavailable === 'hidden') f.replyComposer.setAttribute('hidden', '');
    if (unavailable === 'disabled') f.replyEditor.disabled = true;
    if (unavailable === 'readonly') f.replyEditor.readOnly = true;
    if (unavailable === 'aria-disabled') f.replyEditor.setAttribute('aria-disabled', 'true');
    f.context.lastEditor = f.mainEditor;
    assert.ok(f.context.structuralEditors().includes(f.replyEditor));
    assert.ok(!f.context.candidateEditors().includes(f.replyEditor));
    const snapshot = f.select(f.replyMessage.textNode);
    assert.ok(snapshot);
    assert.equal(snapshot.scope, f.replyRoot);
    assert.equal(snapshot.editor, null);
    assert.equal(f.context.findEditor(snapshot), null);
  });
}

test('reply context: multiple reply editors are ambiguous without a local focus choice', () => {
  const f = mainAndReply();
  const second = composer({}, { 'data-testid': 'second-reply-composer' });
  f.replyRoot.append(second.wrapper);
  f.context.lastEditor = f.mainEditor;
  const snapshot = f.select(f.replyMessage.textNode);
  assert.equal(snapshot.editor, null);
  f.context.lastEditor = second.editor;
  assert.equal(f.context.findEditor(snapshot), second.editor);
});

test('reply context: selected ranges crossing main and reply boundaries are rejected', () => {
  const f = mainAndReply();
  assert.equal(f.select(f.mainMessage.textNode, f.replyMessage.textNode, 'Cruza conversaciones.'), null);
});

test('reply context: selected ranges crossing inline scopes within one main are rejected', () => {
  const f = mainAndReply({ tag: 'div' });
  assert.equal(f.select(f.mainMessage.textNode, f.replyMessage.textNode, 'Cruza hilos.'), null);
});

test('reply context: selection across two messages of one reply is allowed', () => {
  const f = mainAndReply();
  const second = message('Otro mensaje en el mismo hilo.');
  f.replyLog.append(second.root);
  const snapshot = f.select(f.replyMessage.textNode, second.textNode, 'Dos fragmentos del mismo hilo.');
  assert.ok(snapshot);
  assert.equal(snapshot.editor, f.replyEditor);
});

test('reply context: replacing a dialog at the same URL invalidates the captured source', () => {
  const f = mainAndReply({ tag: 'dialog', panelAttributes: { open: '' } });
  const snapshot = f.select(f.replyMessage.textNode);
  assert.equal(f.context.snapshotStillValid(snapshot), true);
  f.replyRoot.remove();
  const replacement = el('dialog', { open: '' }, message().root, composer().wrapper);
  f.main.append(replacement);
  assert.equal(f.context.snapshotStillValid(snapshot), false);
});

test('reply context: replacing only the editor does not silently redirect an old snapshot', () => {
  const f = mainAndReply();
  const snapshot = f.select(f.replyMessage.textNode);
  assert.equal(f.context.snapshotStillValid(snapshot), true);
  f.replyEditor.remove();
  const replacement = el('div', { contenteditable: 'true', 'aria-label': 'Reply' });
  f.replyComposer.append(replacement);
  assert.equal(f.context.snapshotContextValid(snapshot), false);
  assert.equal(f.context.snapshotStillValid(snapshot), false);
  assert.equal(snapshot.editor, f.replyEditor, 'The destination remains the original object, not the replacement.');
});

test('reply context: moving the selected source out of an inline reply invalidates its scope', () => {
  const f = mainAndReply({ tag: 'div' });
  const snapshot = f.select(f.replyMessage.textNode);
  assert.equal(f.context.snapshotStillValid(snapshot), true);
  f.main.append(f.replyMessage.root);
  assert.equal(f.context.snapshotContextValid(snapshot), false);
});

test('reply context: an unchanged snapshot remains valid after focus moves to the main editor', () => {
  const f = mainAndReply();
  const snapshot = f.select(f.replyMessage.textNode);
  f.context.lastEditor = f.mainEditor;
  assert.equal(f.context.snapshotStillValid(snapshot), true);
  assert.equal(snapshot.editor, f.replyEditor);
});

test('reply context: quoted previews inside a composer do not establish a conversation scope', () => {
  const f = mainAndReply({ tag: 'div', noReplyEditor: true });
  f.replyLog.remove();
  const preview = message('Una vista previa no es un hilo.');
  f.replyComposer.append(preview.root);
  f.replyRoot.append(f.replyComposer);
  assert.equal(f.context.editorScope(f.replyEditor), f.main);
  assert.notEqual(f.context.editorScope(f.replyEditor), f.replyRoot);
});

test('reply context: an aside next to the main composer cannot shrink the main scope', () => {
  const f = mainAndReply();
  const localWrapper = el('div', {}, f.mainComposer, f.replyRoot);
  f.main.append(localWrapper);
  assert.equal(f.context.conversationBoundary(f.replyMessage.textNode), f.replyRoot);
  assert.equal(f.context.editorScope(f.mainEditor), f.main);
  assert.notEqual(f.context.editorScope(f.mainEditor), localWrapper);
  assert.equal(f.select(f.mainMessage.textNode).editor, f.mainEditor);
  assert.equal(f.select(f.replyMessage.textNode).editor, f.replyEditor);
});

test('reply context: display:contents source wrappers are valid when their text range has boxes', () => {
  const f = mainAndReply();
  f.replyMessage.paragraph.style.display = 'contents';
  f.replyMessage.paragraph.rect = { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
  assert.equal(f.context.isVisible(f.replyMessage.paragraph), false);
  assert.equal(f.context.isVisible(f.replyMessage.paragraph, false), true);
  const snapshot = f.select(f.replyMessage.textNode);
  assert.ok(snapshot);
  assert.equal(snapshot.editor, f.replyEditor);
  assert.equal(f.context.snapshotContextValid(snapshot), true);
  assert.equal(f.context.snapshotStillValid(snapshot), true);
  snapshot.range.getClientRects = () => [];
  assert.equal(f.context.snapshotContextValid(snapshot), false, 'A source with no visible range is rejected.');
});

test('reply context: an ancestor message containing the editor is not its separate reply scope', () => {
  const f = mainAndReply({ tag: 'div', inlineInMessage: true });
  f.replyLog.remove();
  assert.equal(f.context.editorScope(f.replyEditor), f.main);
  assert.notEqual(f.context.editorScope(f.replyEditor), f.mainMessage.root);
});

test('reply context: panel navigation and composer text cannot become quote selections', () => {
  const f = mainAndReply();
  const navigationText = new TextNode('Navegación del panel.');
  f.replyRoot.append(el('nav', {}, navigationText));
  assert.equal(f.select(navigationText), null);
  const editorText = new TextNode('Borrador que no se debe citar.');
  f.replyEditor.append(editorText);
  assert.equal(f.select(editorText), null);
});
