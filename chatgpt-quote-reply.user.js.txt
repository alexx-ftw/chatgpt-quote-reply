// ==UserScript==
// @name         ChatGPT & Dots — Citar selección
// @namespace    local.chatgpt.quote-reply
// @version      1.0.3
// @description  Cita texto seleccionado exclusivamente en Dots. Sin envío automático, telemetría ni APIs privadas. Pendiente de validar en vivo.
// @homepageURL  https://github.com/alexx-ftw/chatgpt-quote-reply
// @supportURL   https://github.com/alexx-ftw/chatgpt-quote-reply/issues
// @updateURL    https://raw.githubusercontent.com/alexx-ftw/chatgpt-quote-reply/main/chatgpt-quote-reply.meta.js
// @downloadURL  https://raw.githubusercontent.com/alexx-ftw/chatgpt-quote-reply/main/chatgpt-quote-reply.user.js
// @match        https://chatgpt.com/dots
// @match        https://chatgpt.com/dots/*
// @run-at       document-idle
// @grant        none
// @noframes
// @license      MIT
// ==/UserScript==

(() => {
  'use strict';

  // The userscript manager limits execution to chatgpt.com/dots. Tests run only
  // against local, synthetic fixtures, never against an authenticated site.
  const ROOT_ID = 'chatgpt-quote-reply';
  const MAX_SELECTION = 50000;
  const RICH_EDITOR = '[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"]';
  const EDITABLE = `textarea,${RICH_EDITOR}`;
  const EXCLUDED = 'input,textarea,select,button,[contenteditable=""],[contenteditable="true"],'
    + '[contenteditable="plaintext-only"],[role="textbox"],nav,header,'
    + '[role="navigation"],[role="alertdialog"],[data-markdown-copy="exclude"]';
  const MESSAGE_ROOT = '[data-message-author-role],[data-message-id],'
    + '[data-testid^="conversation-turn-"],[data-message-content]';
  const MESSAGE = `${MESSAGE_ROOT},.markdown`;
  const MAIN = 'main,[role="main"],[role="log"]';
  const PAGE = 'main,[role="main"]';
  const PANEL = 'aside,dialog,[role="dialog"],[role="complementary"],[aria-modal="true"],'
    + '[data-reply-thread],[data-thread-panel],[data-testid="reply-thread"],'
    + '[data-testid="thread-panel"],[data-testid="reply-panel"]';
  const COMPOSER = '[data-testid*="composer"],[id*="composer"],[data-type="chat-composer"]';

  if (!isChatRoute() || !document.body || document.getElementById(ROOT_ID) || window.top !== window) return;

  const host = document.createElement('div');
  host.id = ROOT_ID;
  host.setAttribute('data-userscript-version', '1.0.3');
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    :host { color-scheme: light dark; }
    *, *::before, *::after { box-sizing: border-box; }
    .bar, .panel, .status { font: 14px/1.45 system-ui, sans-serif; color: #202123;
      background: #fff; border: 1px solid #c9ccd1; border-radius: 12px;
      box-shadow: 0 5px 24px #0003; pointer-events: auto; }
    [hidden] { display: none !important; }
    .bar { position: fixed; display: flex; align-items: center; gap: 4px; padding: 5px; }
    button { font: inherit; font-weight: 600; color: inherit; background: transparent;
      border: 0; border-radius: 8px; padding: 8px 12px; cursor: pointer; }
    button:hover { background: #edf0f3; }
    button:focus-visible { outline: 2px solid #397de8; outline-offset: 1px; }
    button:disabled { opacity: .5; cursor: wait; }
    .primary { color: #fff; background: #146b50; }
    .primary:hover { background: #0e5740; }
    .status { position: fixed; bottom: 90px; left: 50%; transform: translateX(-50%);
      max-width: calc(100vw - 32px); width: max-content; padding: 12px 16px;
      pointer-events: none; }
    .panel { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%);
      width: min(560px, calc(100vw - 24px)); max-height: calc(100vh - 48px);
      overflow: auto; padding: 16px; }
    .panel p { margin: 0 0 12px; }
    textarea { display: block; width: 100%; min-height: 130px; max-height: 40vh;
      resize: vertical; padding: 10px; background: #f6f7f8; color: inherit;
      border: 1px solid #b8bec6; border-radius: 8px; font: 13px/1.5 ui-monospace, monospace; }
    .actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
    @media (prefers-color-scheme: dark) {
      .bar, .panel, .status { color: #f3f4f5; background: #25272b; border-color: #555b63; }
      button:hover { background: #393e44; }
      .primary { background: #177755; }
      .primary:hover { background: #1b8962; }
      textarea { background: #17191d; border-color: #555b63; }
    }
  `;
  shadow.append(style);

  function element(tag, attrs = {}, text = '') {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    node.textContent = text;
    return node;
  }

  const bar = element('div', { class: 'bar', role: 'group', 'aria-label': 'Citar texto seleccionado' });
  const quoteButton = element('button', {
    type: 'button', class: 'primary', 'aria-label': 'Citar selección',
    title: 'Añadir la selección al borrador. Alt+Mayús+Q',
  }, 'Citar');
  const copyButton = element('button', { type: 'button', 'aria-label': 'Copiar cita' }, 'Copiar');
  bar.append(quoteButton, copyButton);
  bar.hidden = true;

  const status = element('div', { class: 'status', role: 'status', 'aria-live': 'polite' });
  status.hidden = true;
  const panel = element('section', {
    class: 'panel', role: 'dialog', 'aria-label': 'Copiar la cita manualmente',
  });
  const explanation = element('p');
  const copyArea = element('textarea', { readonly: '', 'aria-label': 'Cita para copiar' });
  const panelActions = element('div', { class: 'actions' });
  const panelCopy = element('button', { type: 'button' }, 'Copiar al portapapeles');
  const panelClose = element('button', { type: 'button' }, 'Cerrar');
  panelActions.append(panelCopy, panelClose);
  panel.append(explanation, copyArea, panelActions);
  panel.hidden = true;
  shadow.append(bar, status, panel);
  document.body.append(host);

  let pending = null;
  let busy = false;
  let pointerDown = false;
  let selectionTimer = 0;
  let statusTimer = 0;
  let lastEditor = null;
  let knownUrl = location.href;

  function asElement(node) {
    return node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  }

  function isChatRoute() {
    return /^\/dots(?:\/|$)/.test(location.pathname);
  }

  function syncRoute() {
    if (knownUrl !== location.href) {
      knownUrl = location.href;
      hideBar();
      panel.hidden = true;
      status.hidden = true;
      clearTimeout(selectionTimer);
      clearTimeout(statusTimer);
      lastEditor = null;
    }
    const allowed = isChatRoute();
    if (host.hidden !== !allowed) host.hidden = !allowed;
    return allowed;
  }

  function isVisible(node, requireBox = true) {
    if (!node?.isConnected || (requireBox && !Array.from(node.getClientRects()).some(r => r.width > 0 && r.height > 0))) return false;
    if (node.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
    const css = getComputedStyle(node);
    if (css.display === 'none' || css.visibility === 'hidden' || css.visibility === 'collapse') return false;
    for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) {
      if (getComputedStyle(ancestor).opacity === '0') return false;
    }
    return true;
  }

  function validSelectionEnd(node) {
    const el = asElement(node);
    if (!el || el.closest(EXCLUDED) || host.contains(el)) return false;
    // A conversation panel is allowed; navigation/settings text in one is not.
    if (el.closest(PANEL)) return !!el.closest(MESSAGE_ROOT);
    return !!el.closest(`${MAIN},${MESSAGE}`);
  }

  function conversationBoundary(node) {
    const el = asElement(node);
    // A reply's log and composer can be siblings. Do not stop at role="log".
    return el?.closest(PANEL) || el?.closest(PAGE) || document.body;
  }

  function isReplyComposer(editor) {
    const labels = ['placeholder', 'aria-label', 'data-placeholder', 'data-testid']
      .map(name => editor.getAttribute(name) || '').join(' ');
    const wrapper = editor.closest(COMPOSER);
    const marker = wrapper ? `${wrapper.id} ${wrapper.getAttribute('data-testid') || ''}` : '';
    const words = `${labels} ${marker}`.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ');
    return /\brepl(?:y|ies)\b|\bresponder\b|\brespuesta\b|\bthread\s+composer\b/i.test(words);
  }

  function structuralEditors() {
    // Include hidden/disabled editors when discovering scopes: a temporarily
    // unavailable reply composer must not redirect its quote to the main chat.
    const roots = `${EDITABLE},[contenteditable="false"]`;
    return Array.from(document.querySelectorAll(roots)).filter(el => {
      if (el.closest('nav,header,[role="navigation"],[role="alertdialog"]')) return false;
      if (el.closest(MESSAGE_ROOT) && !isReplyComposer(el)) return false;
      if (el.tagName !== 'TEXTAREA' && !el.isContentEditable
        && !(el.getAttribute('contenteditable') === 'false'
          && (el.getAttribute('role') === 'textbox' || el.closest(COMPOSER) || isReplyComposer(el)))) return false;
      return !el.parentElement?.closest(RICH_EDITOR);
    });
  }

  function editorScope(editor) {
    const boundary = conversationBoundary(editor);
    const wrapper = editor.closest(COMPOSER);
    const composer = wrapper && boundary.contains(wrapper) ? wrapper : editor;
    // The smallest common container of messages and their composer also handles
    // inline replies without depending on generated class names or private APIs.
    for (let scope = composer.parentElement; scope && boundary.contains(scope); scope = scope.parentElement) {
      const messages = Array.from(scope.querySelectorAll(MESSAGE_ROOT));
      if (messages.some(message => conversationBoundary(message) === boundary
        && !message.contains(editor) && !composer.contains(message))) return scope;
      if (scope === boundary) break;
    }
    return boundary;
  }

  function selectionScope(node, editors = structuralEditors()) {
    const el = asElement(node);
    const boundary = conversationBoundary(el);
    let scope = boundary;
    for (const editor of editors) {
      if (conversationBoundary(editor) !== boundary) continue;
      const candidate = editorScope(editor);
      if (candidate.contains(el) && scope.contains(candidate)) scope = candidate;
    }
    // A nested message can be an inline reply whose composer is unmounted.
    // Do not let the outer conversation's editor become its fallback.
    const rowSelector = 'article[data-message-id],article[data-message-author-role]';
    const row = el?.closest(rowSelector);
    const outerRow = row?.parentElement?.closest(rowSelector);
    if (outerRow && scope.contains(outerRow)) scope = row.parentElement;
    return scope;
  }

  function selectionSnapshot() {
    if (!isChatRoute()) return null;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
    const range = selection.getRangeAt(0);
    if (!validSelectionEnd(range.startContainer) || !validSelectionEnd(range.endContainer)) return null;
    const editors = structuralEditors();
    const boundary = conversationBoundary(range.startContainer);
    const scope = selectionScope(range.startContainer, editors);
    if (boundary !== conversationBoundary(range.endContainer)
      || scope !== selectionScope(range.endContainer, editors)) return null;
    const text = selection.toString().replace(/\r\n?/g, '\n');
    if (!text.trim()) return null;
    const rects = Array.from(range.getClientRects()).filter(r => r.width > 0 && r.height > 0);
    const rect = rects.at(-1) || range.getBoundingClientRect();
    if (!rect.width && !rect.height) return null;
    const snapshot = { text, rangeText: range.toString(), url: location.href,
      range: range.cloneRange(), rect, boundary, scope };
    snapshot.editor = findEditor(snapshot);
    return snapshot;
  }

  function blockquote(text) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines.at(-1).trim()) lines.pop();
    // Only text is inserted, never HTML. Internal whitespace is preserved.
    return lines.map(line => line ? `> ${line}` : '>').join('\n');
  }

  function hideBar() {
    bar.hidden = true;
    pending = null;
  }

  function notify(message) {
    if (!isChatRoute()) return;
    clearTimeout(statusTimer);
    status.textContent = message;
    status.hidden = false;
    statusTimer = setTimeout(() => { status.hidden = true; }, 5000);
  }

  function refreshSelection() {
    if (!syncRoute()) return;
    if (busy || pointerDown || !panel.hidden || shadow.activeElement) return;
    const snapshot = selectionSnapshot();
    if (!snapshot) { hideBar(); return; }
    mountOverlay(snapshot);
    pending = snapshot;
    bar.hidden = false;
    const rect = snapshot.rect;
    const bounds = bar.getBoundingClientRect();
    const x = Math.max(8, Math.min(rect.left, window.innerWidth - bounds.width - 8));
    const below = rect.bottom + 10;
    const y = below + bounds.height < window.innerHeight - 8
      ? below : Math.max(8, Math.min(rect.top - bounds.height - 10, window.innerHeight - bounds.height - 8));
    bar.style.left = `${x}px`;
    bar.style.top = `${y}px`;
  }

  function scheduleSelection() {
    clearTimeout(selectionTimer);
    if (!syncRoute()) return;
    selectionTimer = setTimeout(refreshSelection, 90);
  }

  function candidateEditors() {
    return structuralEditors().filter(el => isVisible(el) && !el.disabled
      && !el.readOnly && el.getAttribute('aria-disabled') !== 'true'
      && (el.tagName === 'TEXTAREA' || el.isContentEditable));
  }

  function editorScore(el) {
    if (el.id === 'prompt-textarea') return 100;
    if (/prompt|composer|chat-input|message-input/i.test(el.getAttribute('data-testid') || '')) return 90;
    if (el.closest(COMPOSER)) return 80;
    const labels = ['placeholder', 'aria-label', 'data-placeholder'].map(a => el.getAttribute(a) || '').join(' ');
    if (/message|mensaje|ask|pregunt|escrib|chat|habla|talk|reply|responder|respuesta/i.test(labels)) return 50;
    return el.closest(`${MAIN},${PANEL}`) ? 20 : 0;
  }

  function findEditor(snapshot) {
    if (!snapshot?.scope || !snapshot.boundary) return null;
    // Filter by conversation FIRST. A strong main editor and a stale focus
    // reference must never beat a generic composer in the selected reply.
    const candidates = candidateEditors().filter(el => conversationBoundary(el) === snapshot.boundary
      && editorScope(el) === snapshot.scope);
    const strong = candidates.filter(el => editorScore(el) >= 80);
    if (strong.length === 1) return strong[0];
    if (strong.length > 1) return strong.includes(lastEditor) ? lastEditor : null;
    if (candidates.includes(lastEditor) && editorScore(lastEditor) >= 20) return lastEditor;
    const labeled = candidates.filter(el => editorScore(el) >= 50);
    if (labeled.length === 1) return labeled[0];
    if (candidates.length === 1 && editorScore(candidates[0]) >= 20) return candidates[0];
    return null; // Never choose an arbitrary editor when there is ambiguity.
  }

  function mountOverlay(snapshot) {
    const source = asElement(snapshot?.range.startContainer);
    // Native modal dialogs are in the top layer: a body-level z-index cannot
    // place our controls above them. Keep the controls inside their focus scope.
    const target = source?.closest('dialog[open],[role="dialog"],[aria-modal="true"],[popover]') || document.body;
    if (host.parentElement !== target) target.append(host);
  }

  function syncOverlay() {
    if (!host.isConnected || (host.parentElement !== document.body
      && (!isChatRoute() || !isVisible(host.parentElement)))) {
      hideBar();
      panel.hidden = true;
      status.hidden = true;
      mountOverlay(null);
    }
  }

  function editorText(editor) {
    return editor.tagName === 'TEXTAREA' ? editor.value : (editor.innerText ?? editor.textContent ?? '');
  }

  function comparable(text) {
    // Rich editors can change whitespace representation without losing text.
    return text.replace(/\s+/g, ' ').trim();
  }

  function showCopyPanel(quote, reason) {
    if (!isChatRoute()) return;
    hideBar();
    explanation.textContent = reason + ' Copia esta cita y pégala en tu mensaje. No se ha enviado nada.';
    copyArea.value = quote + '\n\n';
    panel.hidden = false;
    copyArea.focus();
    copyArea.select();
  }

  async function copyText(text) {
    if (!isChatRoute()) return false;
    if (!navigator.clipboard?.writeText) return false;
    try { await navigator.clipboard.writeText(text); return true; }
    catch { return false; }
  }

  function snapshotStillValid(snapshot) {
    return isChatRoute() && snapshot && snapshot.url === location.href
      && snapshot.range.startContainer.isConnected && snapshot.range.endContainer.isConnected
      && snapshot.range.toString() === snapshot.rangeText && snapshotContextValid(snapshot);
  }

  function snapshotContextValid(snapshot) {
    if (!snapshot.scope?.isConnected || !snapshot.boundary?.isConnected) return false;
    const start = asElement(snapshot.range.startContainer);
    const end = asElement(snapshot.range.endContainer);
    // Text in display:contents wrappers has range rectangles but no parent box.
    if (!isVisible(start, false) || !isVisible(end, false)
      || !Array.from(snapshot.range.getClientRects()).some(rect => rect.width > 0 && rect.height > 0)
      || !validSelectionEnd(start) || !validSelectionEnd(end)) return false;
    if (conversationBoundary(start) !== snapshot.boundary || conversationBoundary(end) !== snapshot.boundary) return false;
    const editors = structuralEditors();
    if (selectionScope(start, editors) !== snapshot.scope || selectionScope(end, editors) !== snapshot.scope) return false;
    // Capture the destination along with the source. Closing/replacing a reply
    // at the same URL must not silently rediscover a different draft.
    return !snapshot.editor || (editors.includes(snapshot.editor)
      && conversationBoundary(snapshot.editor) === snapshot.boundary && editorScope(snapshot.editor) === snapshot.scope);
  }

  async function appendQuote(editor, quote, contextValid = () => true) {
    const originalUrl = location.href;
    if (!editor.isConnected || editor.disabled || editor.readOnly || !contextValid()) return { ok: false, changed: false };
    editor.focus();
    // A focus handler may navigate, replace the editor, or move focus elsewhere.
    // Read the draft only after focus, and never type into a redirected target.
    if (!isVisible(editor) || location.href !== originalUrl || document.activeElement !== editor
      || editor.disabled || editor.readOnly || editor.getAttribute('aria-disabled') === 'true'
      || (editor.tagName !== 'TEXTAREA' && !editor.isContentEditable) || !contextValid()) {
      return { ok: false, changed: false };
    }
    const before = editorText(editor);
    const beforeMarkup = editor.tagName === 'TEXTAREA' ? before : editor.innerHTML;
    const addition = (before.trim() ? '\n\n' : '') + quote + '\n\n';
    if (editor.tagName === 'TEXTAREA' && editor.maxLength >= 0
      && before.length + addition.length > editor.maxLength) return { ok: false, changed: false };
    let inputSeen = false;
    const beforeInputEvents = [];
    const onInput = () => { inputSeen = true; };
    const onBeforeInput = event => { beforeInputEvents.push(event); };
    editor.addEventListener('input', onInput);
    editor.addEventListener('beforeinput', onBeforeInput, true);
    let commandError = false;
    try {
      if (editor.tagName === 'TEXTAREA') {
        editor.setSelectionRange(before.length, before.length);
      } else {
        const selection = window.getSelection();
        if (!selection) return { ok: false, changed: false };
        const insertion = document.createRange();
        insertion.selectNodeContents(editor);
        insertion.collapse(false);
        selection.removeAllRanges();
        selection.addRange(insertion);
      }
      // Native editing preserves existing rich nodes and usually the undo stack.
      // Never select all, replace innerHTML, simulate Enter, or call submit.
      if (typeof document.execCommand === 'function') document.execCommand('insertText', false, addition);
    } catch {
      commandError = true;
    } finally {
      editor.removeEventListener('input', onInput);
      editor.removeEventListener('beforeinput', onBeforeInput, true);
    }

    let after = editorText(editor);
    let changed = editor.tagName === 'TEXTAREA' ? after !== before : editor.innerHTML !== beforeMarkup;
    if (!changed && !inputSeen && editor.tagName === 'TEXTAREA' && !commandError
      && !beforeInputEvents.some(event => event.defaultPrevented)
      && !editor.disabled && !editor.readOnly && editor.isConnected) {
      // Controlled textareas need the prototype setter followed by input.
      // Respect cancellation: do not force text past an editor's beforeinput.
      const allowed = beforeInputEvents.length > 0 || editor.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true, cancelable: true, inputType: 'insertText', data: addition,
      }));
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      if (allowed && setter && editor.value === before && !editor.disabled && !editor.readOnly
        && editor.getAttribute('aria-disabled') !== 'true' && isVisible(editor)
        && document.activeElement === editor && location.href === originalUrl && contextValid()) {
        setter.call(editor, before + addition);
        editor.setSelectionRange(editor.value.length, editor.value.length);
        changed = true;
        inputSeen = false;
      }
    }
    if (changed && !inputSeen) {
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: addition }));
    }
    // Give controlled editors one short render cycle to reject an unsupported edit.
    await new Promise(resolve => setTimeout(resolve, 70));
    after = editorText(editor);
    changed = editor.tagName === 'TEXTAREA' ? after !== before : editor.innerHTML !== beforeMarkup;
    const expected = comparable(before + addition);
    const actual = comparable(after);
    return { ok: editor.isConnected && location.href === originalUrl && contextValid() && actual.startsWith(expected), changed };
  }

  async function quoteSelection(snapshot) {
    if (busy) return;
    if (!snapshotStillValid(snapshot)) {
      hideBar();
      notify('La selección o la conversación ha cambiado. Selecciona el fragmento de nuevo.');
      return;
    }
    if (snapshot.text.length > MAX_SELECTION) {
      notify('La selección supera 50.000 caracteres. Elige un fragmento más corto; no se ha truncado.');
      return;
    }
    mountOverlay(snapshot);
    const quote = blockquote(snapshot.text);
    const editor = snapshot.editor;
    if (!editor) {
      showCopyPanel(quote, 'No he identificado un único editor en este chat o reply. El borrador no se ha modificado.');
      return;
    }
    busy = true;
    quoteButton.disabled = true;
    hideBar();
    try {
      const result = await appendQuote(editor, quote, () => snapshotStillValid(snapshot));
      if (snapshot.url !== location.href) {
        notify('La conversación ha cambiado. Revisa el borrador del chat original.');
        return;
      }
      if (result.ok) {
        lastEditor = editor;
      } else if (result.changed) {
        showCopyPanel(quote, 'El editor cambió, pero no pude confirmar la cita completa. Revisa el borrador antes de pegar para evitar duplicados.');
      } else {
        showCopyPanel(quote, 'El editor no aceptó la inserción. El borrador no se ha modificado.');
      }
    } catch {
      showCopyPanel(quote, 'No pude confirmar la inserción. Revisa el borrador antes de pegar para evitar duplicados.');
    } finally {
      busy = false;
      quoteButton.disabled = false;
    }
  }

  // Keep the selection intact when the mouse presses our floating controls.
  bar.addEventListener('pointerdown', event => event.preventDefault());
  bar.addEventListener('mousedown', event => event.preventDefault());
  quoteButton.addEventListener('click', () => { void quoteSelection(pending); });
  copyButton.addEventListener('click', async () => {
    const snapshot = pending;
    if (!snapshotStillValid(snapshot)) { hideBar(); notify('Selecciona el fragmento de nuevo.'); return; }
    const quote = blockquote(snapshot.text);
    if (await copyText(quote + '\n\n')) { hideBar(); notify('Cita copiada.'); }
    else showCopyPanel(quote, 'El navegador no permitió copiar automáticamente.');
  });
  panelCopy.addEventListener('click', async () => {
    if (!syncRoute()) return;
    if (await copyText(copyArea.value)) notify('Cita copiada.');
    else { copyArea.focus(); copyArea.select(); notify('Usa Ctrl+C o Cmd+C para copiar la cita seleccionada.'); }
  });
  panelClose.addEventListener('click', () => { panel.hidden = true; hideBar(); });

  document.addEventListener('focusin', event => {
    if (!syncRoute()) return;
    const target = event.target;
    if (target instanceof HTMLElement && target.matches(EDITABLE)
      && candidateEditors().includes(target) && editorScore(target) >= 20) lastEditor = target;
  });
  document.addEventListener('pointerdown', event => {
    if (event.composedPath().includes(host)) return;
    pointerDown = true;
    hideBar();
  }, true);
  document.addEventListener('pointerup', () => { pointerDown = false; scheduleSelection(); }, true);
  document.addEventListener('pointercancel', () => { pointerDown = false; hideBar(); }, true);
  document.addEventListener('selectionchange', scheduleSelection);
  document.addEventListener('keyup', scheduleSelection);
  document.addEventListener('keydown', event => {
    if (!syncRoute()) return;
    if (event.key === 'Escape') { panel.hidden = true; hideBar(); status.hidden = true; return; }
    if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && !event.repeat
      && (event.code === 'KeyQ' || event.key.toLowerCase() === 'q')) {
      const snapshot = selectionSnapshot();
      if (snapshot) { event.preventDefault(); void quoteSelection(snapshot); }
    }
  });
  // A client-side navigation need not reload the document. Drop pending UI
  // when the visible app changes route, without patching its history methods.
  const routeObserver = new MutationObserver(() => { syncRoute(); syncOverlay(); });
  routeObserver.observe(document.body, {
    childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'hidden', 'inert', 'aria-hidden'],
  });
  window.addEventListener('popstate', syncRoute);
  window.addEventListener('hashchange', syncRoute);
  window.addEventListener('resize', hideBar);
  window.addEventListener('blur', () => { pointerDown = false; hideBar(); });
  document.addEventListener('scroll', () => { if (!busy) hideBar(); }, true);
})();
// END CHATGPT-QUOTE-REPLY 1.0.3
