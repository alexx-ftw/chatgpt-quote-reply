/*
 * Offline browser-contract tests. Every page is a synthetic localhost fixture.
 * These tests do NOT verify or reproduce ChatGPT's actual current DOM.
 * All non-fixture network requests are aborted and treated as failures.
 */
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const moduleRoot = process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
let playwright;
try { playwright = require('playwright'); }
catch (error) {
  if (!moduleRoot) throw error;
  playwright = require(path.join(moduleRoot, 'playwright'));
}

const scriptPath = path.join(__dirname, '..', 'chatgpt-quote-reply.user.js');
const fixtureURL = 'http://127.0.0.1:17381/dots/offline-fixture';
let browser;
let source;

before(async () => {
  source = fs.readFileSync(scriptPath, 'utf8');
  const fallbackBinary = '/usr/bin/chromium';
  const executablePath = process.env.QUOTE_TEST_CHROMIUM ||
    (fs.existsSync(playwright.chromium.executablePath())
      ? playwright.chromium.executablePath() : fallbackBinary);
  assert.ok(fs.existsSync(executablePath), 'An existing Chromium binary is required; tests never install one.');
  browser = await playwright.chromium.launch({
    executablePath,
    headless: true,
    args: ['--disable-background-networking', '--disable-component-update'],
  });
});

after(async () => { await browser?.close(); });

function pageHTML(editor, extra = '', outsideMain = '') {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
  <title>Offline quote helper fixture</title><style>
  body { margin: 24px; font: 16px/1.5 sans-serif; color: #17212c; background: #fafafa; }
  main { max-width: 720px; margin: 20px auto; }
  article { padding: 16px; border: 1px solid #ccc; background: white; }
  aside, [role="dialog"], dialog { max-width: 720px; margin: 20px auto; padding: 16px; }
  dialog { width: min(700px, 80vw); }
  textarea, [contenteditable="true"], [contenteditable=""] { display: block; min-height: 85px; width: 90%;
    padding: 12px; margin-top: 24px; border: 1px solid #777; background: white; }
  [hidden] { display: none !important; }
  </style></head><body>
  <nav><span id="navigation-text">Texto de navegación que no se debe citar</span></nav>
  <main>
    <article data-message-author-role="assistant" data-message-id="fixture-message">
      <p id="passage-one">Una respuesta concreta para preguntar sobre ella.</p>
      <p id="passage-two">Segundo fragmento independiente.</p>
      <pre id="multiline">Línea uno\n\n    línea con sangría\núltima línea</pre>
      <pre id="literal-markup"></pre>
    </article>
    ${editor}
    ${extra}
  </main>${outsideMain}</body></html>`;
}

const plainEditor = '<textarea id="prompt-textarea" aria-label="Mensaje"></textarea>';
const richEditor = '<div id="prompt-textarea" role="textbox" aria-label="Mensaje" contenteditable="true"></div>';
const primaryForm = `<form>${plainEditor}<button id="send" type="submit">Enviar</button></form>`;
const replyMessage = '<article data-message-author-role="assistant" data-message-id="secondary-message"><p id="reply-passage">Fragmento de la respuesta en hilo.</p></article>';
const primaryDraft = 'Borrador principal intacto.';
const replyDraft = 'Borrador del hilo.';

async function fixture(t, editor = plainEditor, extra = '', viewport = { width: 1120, height: 900 }, outsideMain = '') {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
  const page = await context.newPage();
  const requests = [];
  const errors = [];
  const html = pageHTML(editor, extra, outsideMain);
  await page.route('**/*', async route => {
    if (route.request().url() === fixtureURL && route.request().isNavigationRequest()) {
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html });
      return;
    }
    requests.push(route.request().url());
    await route.abort();
  });
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(fixtureURL);
  await page.evaluate(() => {
    window.__quoteFixture = { submissions: 0, sends: 0, inputs: 0, inputValue: '' };
    document.addEventListener('submit', event => {
      event.preventDefault();
      window.__quoteFixture.submissions++;
    });
    document.addEventListener('input', event => {
      if (event.target.matches('textarea, [contenteditable]')) {
        window.__quoteFixture.inputs++;
        window.__quoteFixture.inputValue = event.target.value ?? event.target.innerText;
      }
    });
    document.addEventListener('click', event => {
      if (event.composedPath().some(node => node instanceof Element &&
          node.matches('#send, [data-fixture-send]'))) window.__quoteFixture.sends++;
    }, true);
  });
  await page.addScriptTag({ content: source });
  t.after(async () => {
    const counters = await page.evaluate(() => ({
      submissions: window.__quoteFixture.submissions, sends: window.__quoteFixture.sends,
    }));
    await context.close();
    assert.equal(counters.submissions, 0, 'The helper must never submit a form.');
    assert.equal(counters.sends, 0, 'The helper must never click Send.');
    assert.deepEqual(requests, [], 'The helper must not initiate network requests.');
    assert.deepEqual(errors, [], 'The helper must not cause uncaught page errors.');
  });
  return page;
}

function quoteButton(page) {
  return page.getByRole('button', { name: 'Citar selección', exact: true });
}

async function select(page, selector, { expectButton = true } = {}) {
  await page.locator(selector).click({ position: { x: 4, y: 5 } });
  await page.locator(selector).evaluate(element => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    element.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'mouse' }));
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    document.dispatchEvent(new Event('selectionchange'));
  });
  if (expectButton) await quoteButton(page).waitFor({ state: 'visible', timeout: 2500 });
  else await page.waitForTimeout(250);
}

async function quote(page, selector = '#passage-one') {
  await select(page, selector);
  await quoteButton(page).click();
}

async function settledText(page, selector = '#prompt-textarea', pattern = /Una respuesta concreta/) {
  await page.waitForFunction(({ selector, patternSource }) => {
    const editor = document.querySelector(selector);
    return new RegExp(patternSource).test(editor?.value ?? editor?.innerText ?? '');
  }, { selector, patternSource: pattern.source }, { timeout: 2500 });
  await page.waitForTimeout(120);
  return page.locator(selector).evaluate(element => element.value ?? element.innerText);
}

test('plain textarea: quotes selection, leaves cursor at the end, emits input without sending', async t => {
  const page = await fixture(t, `<form>${plainEditor}<button id="send" type="submit">Enviar</button></form>`);
  await quote(page);
  const text = await settledText(page);
  assert.match(text, /^> Una respuesta concreta para preguntar sobre ella\.\n\n$/);
  const state = await page.locator('#prompt-textarea').evaluate(element => ({
    cursor: element.selectionStart, end: element.selectionEnd,
    length: element.value.length, focused: document.activeElement === element,
    inputs: window.__quoteFixture.inputs, observed: window.__quoteFixture.inputValue,
  }));
  assert.equal(state.focused, true);
  assert.equal(state.cursor, state.length);
  assert.equal(state.end, state.length);
  assert.ok(state.inputs >= 1);
  assert.equal(state.observed, text);
});

test('preserves the complete textarea draft and supports repeated quote/comment blocks', async t => {
  const page = await fixture(t);
  const draft = '  Borrador previo con espacios  \n';
  await page.locator('#prompt-textarea').fill(draft);
  await quote(page);
  const first = await settledText(page);
  assert.ok(first.startsWith(draft), 'Existing draft must remain byte-for-byte as a prefix.');
  await page.keyboard.type('Mi comentario.');
  await quote(page, '#passage-two');
  const text = await settledText(page, '#prompt-textarea', /Segundo fragmento/);
  assert.ok(text.indexOf('Una respuesta concreta') < text.indexOf('Mi comentario.'));
  assert.ok(text.indexOf('Mi comentario.') < text.indexOf('Segundo fragmento'));
  assert.equal((text.match(/> Una respuesta concreta/g) || []).length, 1);
  assert.equal((text.match(/> Segundo fragmento/g) || []).length, 1);
});

test('multiline selection preserves blank lines and interior indentation', async t => {
  const page = await fixture(t);
  await quote(page, '#multiline');
  const text = await settledText(page, '#prompt-textarea', /Línea uno/);
  const lines = text.replace(/\r/g, '').split('\n').map(line => line.trimEnd());
  assert.deepEqual(lines.slice(0, 4), ['> Línea uno', '>', '>     línea con sangría', '> última línea']);
});

test('contenteditable: appends without replacing rich draft nodes or noneditable mention chips', async t => {
  const editor = '<div id="prompt-textarea" role="textbox" aria-label="Mensaje" contenteditable="true"><p><strong id="draft-strong">Texto importante</strong> <span id="draft-chip" contenteditable="false" data-mention="fixture">@archivo</span></p></div>';
  const page = await fixture(t, editor);
  await page.evaluate(() => {
    window.__quoteFixture.strongNode = document.querySelector('#draft-strong');
    window.__quoteFixture.chipNode = document.querySelector('#draft-chip');
  });
  await quote(page);
  const text = await settledText(page);
  assert.match(text, /Texto importante/);
  assert.match(text, /@archivo/);
  assert.match(text, /> Una respuesta concreta/);
  const nodes = await page.evaluate(() => ({
    sameStrong: document.querySelector('#draft-strong') === window.__quoteFixture.strongNode,
    sameChip: document.querySelector('#draft-chip') === window.__quoteFixture.chipNode,
    strong: document.querySelector('#draft-strong')?.textContent,
    chip: document.querySelector('#draft-chip')?.textContent,
  }));
  assert.equal(nodes.sameStrong, true);
  assert.equal(nodes.sameChip, true);
  assert.equal(nodes.strong, 'Texto importante');
  assert.equal(nodes.chip, '@archivo');
});

test('generic main contenteditable without form or prompt ID is supported', async t => {
  const page = await fixture(t, '<section><div id="generic-editor" contenteditable="true" role="textbox" aria-label="Mensaje a tu dot"></div></section>');
  await quote(page);
  const text = await settledText(page, '#generic-editor');
  assert.match(text, /> Una respuesta concreta/);
});

test('empty contenteditable attribute is a valid editor and is not a quote source', async t => {
  const page = await fixture(t, '<div id="empty-attribute-editor" contenteditable aria-label="Mensaje">Borrador existente</div>');
  await select(page, '#empty-attribute-editor', { expectButton: false });
  assert.equal(await quoteButton(page).isVisible(), false);
  await quote(page);
  const text = await settledText(page, '#empty-attribute-editor');
  assert.ok(text.startsWith('Borrador existente'));
  assert.match(text, /> Una respuesta concreta/);
});

test('hidden legacy editor is ignored in favor of a visible editor', async t => {
  const page = await fixture(t, '<textarea id="prompt-textarea" hidden>NO CAMBIAR</textarea><div id="visible-editor" contenteditable="true" role="textbox" aria-label="Mensaje"></div>');
  await quote(page);
  assert.match(await settledText(page, '#visible-editor'), /> Una respuesta concreta/);
  assert.equal(await page.locator('#prompt-textarea').inputValue(), 'NO CAMBIAR');
});

test('does not offer quoting for a selection inside the composer or navigation', async t => {
  const page = await fixture(t, '<div id="prompt-textarea" role="textbox" contenteditable="true">Un borrador que no se debe citar</div>');
  await select(page, '#prompt-textarea', { expectButton: false });
  assert.equal(await quoteButton(page).isVisible(), false);
  await select(page, '#navigation-text', { expectButton: false });
  assert.equal(await quoteButton(page).isVisible(), false);
});

test('ambiguous editors fail safely, showing the quote to copy without editing either draft', async t => {
  const page = await fixture(t, '<div id="editor-a" contenteditable="true" role="textbox" aria-label="Mensaje A">Alpha</div><div id="editor-b" contenteditable="true" role="textbox" aria-label="Mensaje B">Beta</div>');
  await quote(page);
  const copy = page.getByRole('textbox', { name: 'Cita para copiar', exact: true });
  await copy.waitFor({ state: 'visible', timeout: 2500 });
  assert.match(await copy.inputValue(), /> Una respuesta concreta/);
  assert.equal(await copy.getAttribute('readonly'), '');
  assert.equal(await page.locator('#editor-a').innerText(), 'Alpha');
  assert.equal(await page.locator('#editor-b').innerText(), 'Beta');
});

test('missing or disabled composer produces a manual-copy fallback instead of data loss', async t => {
  const page = await fixture(t, '<textarea id="prompt-textarea" disabled>Intacto</textarea>');
  await quote(page);
  const copy = page.getByRole('textbox', { name: 'Cita para copiar', exact: true });
  await copy.waitFor({ state: 'visible', timeout: 2500 });
  assert.match(await copy.inputValue(), /> Una respuesta concreta/);
  assert.equal(await page.locator('#prompt-textarea').inputValue(), 'Intacto');
});

test('a canceled native beforeinput prevents the textarea setter fallback', async t => {
  const page = await fixture(t);
  await page.locator('#prompt-textarea').fill('Borrador intacto');
  await page.evaluate(() => {
    const editor = document.querySelector('#prompt-textarea');
    editor.addEventListener('beforeinput', event => event.preventDefault());
    // Exercise the canceled-native-edit branch deterministically. Browser
    // execCommand implementations do not all dispatch beforeinput consistently.
    document.execCommand = (command, _showUI, data) => {
      if (command !== 'insertText') throw new Error('Unexpected command');
      editor.dispatchEvent(new InputEvent('beforeinput', {
        bubbles: true, cancelable: true, inputType: 'insertText', data,
      }));
      return false;
    };
  });
  await quote(page);
  await page.getByRole('textbox', { name: 'Cita para copiar', exact: true }).waitFor({ state: 'visible' });
  assert.equal(await page.locator('#prompt-textarea').inputValue(), 'Borrador intacto');
});

test('stale selection after route change is not inserted into a different conversation', async t => {
  const page = await fixture(t);
  await select(page, '#passage-one');
  await page.evaluate(() => history.pushState({}, '', '/dots/different-offline-fixture'));
  if (await quoteButton(page).isVisible()) await quoteButton(page).click();
  await page.waitForTimeout(200);
  assert.equal(await page.locator('#prompt-textarea').inputValue(), '');
});

test('literal HTML and script-looking text remains inert text', async t => {
  const page = await fixture(t, richEditor);
  await page.locator('#literal-markup').evaluate(element => {
    element.textContent = '<img src=x onerror="window.__injected=true">\n<script>window.__injected=true</script>';
  });
  await quote(page, '#literal-markup');
  const text = await settledText(page, '#prompt-textarea', /<img/);
  assert.match(text, /> <img src=x/);
  assert.match(text, /> <script>/);
  assert.equal(await page.locator('#prompt-textarea img, #prompt-textarea script').count(), 0);
  assert.equal(await page.evaluate(() => window.__injected), undefined);
});

test('Alt+Shift+Q quotes the current message selection', async t => {
  const page = await fixture(t);
  await select(page, '#passage-one');
  await page.keyboard.press('Alt+Shift+Q');
  assert.match(await settledText(page), /> Una respuesta concreta/);
});

test('installing twice is idempotent and adds only one quotation per click', async t => {
  const page = await fixture(t);
  await page.addScriptTag({ content: source });
  assert.equal(await page.locator('#chatgpt-quote-reply').count(), 1);
  await quote(page);
  const text = await settledText(page);
  assert.equal((text.match(/Una respuesta concreta/g) || []).length, 1);
});

test('floating controls fit within a narrow viewport and still operate', async t => {
  const page = await fixture(t, plainEditor, '', { width: 390, height: 844 });
  await select(page, '#passage-one');
  const bounds = await quoteButton(page).boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390);
  assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 844);
  await quoteButton(page).click();
  assert.match(await settledText(page), /> Una respuesta concreta/);
});

// The following synthetic layouts describe isolation contracts, not ChatGPT's
// actual DOM. Keep these prepared tests unexecuted in an environment where
// browser startup or host access has been denied.
test('aside reply with a Reply textarea receives its quote without changing the primary draft', async t => {
  const outside = `<aside id="surface">${replyMessage}<form>
    <textarea id="secondary-editor" aria-label="Reply">${replyDraft}</textarea>
    <button type="submit" data-fixture-send>Send reply</button></form></aside>`;
  const page = await fixture(t, primaryForm, '', undefined, outside);
  // Prime the primary editor as the last focused editor; scope must win.
  await page.locator('#prompt-textarea').fill(primaryDraft);
  await quote(page, '#reply-passage');
  const text = await settledText(page, '#secondary-editor', /Fragmento de la respuesta en hilo/);
  assert.ok(text.startsWith(replyDraft));
  assert.match(text, /> Fragmento de la respuesta en hilo\./);
  assert.equal(await page.locator('#prompt-textarea').inputValue(), primaryDraft);
});

test('role=dialog reply with a Responder textarea is isolated from the primary composer', async t => {
  const outside = `<div id="surface" role="dialog" aria-label="Hilo">${replyMessage}<form>
    <textarea id="secondary-editor" aria-label="Responder">${replyDraft}</textarea>
    <button type="submit" data-fixture-send>Responder</button></form></div>`;
  const page = await fixture(t, primaryForm, '', undefined, outside);
  await page.locator('#prompt-textarea').fill(primaryDraft);
  await quote(page, '#reply-passage');
  assert.match(await settledText(page, '#secondary-editor', /Fragmento de la respuesta en hilo/),
    /> Fragmento de la respuesta en hilo\./);
  assert.equal(await page.locator('#prompt-textarea').inputValue(), primaryDraft);
});

test('reply without a composer offers manual copying and never falls back to the primary editor', async t => {
  const page = await fixture(t, primaryForm, '', undefined,
    `<aside id="surface">${replyMessage}</aside>`);
  await page.locator('#prompt-textarea').fill(primaryDraft);
  await quote(page, '#reply-passage');
  const copy = page.getByRole('textbox', { name: 'Cita para copiar', exact: true });
  await copy.waitFor({ state: 'visible', timeout: 2500 });
  assert.match(await copy.inputValue(), /> Fragmento de la respuesta en hilo\./);
  assert.equal(await copy.getAttribute('readonly'), '');
  assert.equal(await page.locator('#prompt-textarea').inputValue(), primaryDraft);
});

test('reply with a disabled composer does not escape into an enabled primary editor', async t => {
  const outside = `<aside id="surface">${replyMessage}
    <textarea id="secondary-editor" aria-label="Reply" disabled>${replyDraft}</textarea></aside>`;
  const page = await fixture(t, primaryForm, '', undefined, outside);
  await page.locator('#prompt-textarea').fill(primaryDraft);
  await quote(page, '#reply-passage');
  await page.getByRole('textbox', { name: 'Cita para copiar', exact: true })
    .waitFor({ state: 'visible', timeout: 2500 });
  assert.equal(await page.locator('#secondary-editor').inputValue(), replyDraft);
  assert.equal(await page.locator('#prompt-textarea').inputValue(), primaryDraft);
});

test('a primary-message selection ignores lastEditor from an open reply', async t => {
  const outside = `<aside id="surface">${replyMessage}<form>
    <textarea id="secondary-editor" aria-label="Reply">${replyDraft}</textarea>
    <button type="submit" data-fixture-send>Send reply</button></form></aside>`;
  const page = await fixture(t, primaryForm, '', undefined, outside);
  await page.locator('#prompt-textarea').fill(primaryDraft);
  await quote(page, '#reply-passage');
  const secondaryBefore = await settledText(page, '#secondary-editor', /Fragmento de la respuesta en hilo/);
  await quote(page, '#passage-one');
  const primary = await settledText(page);
  assert.ok(primary.startsWith(primaryDraft));
  assert.match(primary, /> Una respuesta concreta/);
  assert.equal(await page.locator('#secondary-editor').inputValue(), secondaryBefore);
});

test('native showModal dialog contains the quote control in its own top-layer subtree', async t => {
  const outside = `<dialog id="surface">${replyMessage}<form>
    <textarea id="secondary-editor" aria-label="Reply">${replyDraft}</textarea>
    <button type="submit" data-fixture-send>Send reply</button></form></dialog>`;
  const page = await fixture(t, primaryForm, '', undefined, outside);
  await page.locator('#prompt-textarea').fill(primaryDraft);
  await page.locator('#surface').evaluate(dialog => dialog.showModal());
  await select(page, '#reply-passage');
  const mountedInsideModal = await quoteButton(page).evaluate(button => {
    const dialog = document.querySelector('#surface');
    for (let node = button; node; node = node.parentNode || node.host) {
      if (node === dialog) return true;
    }
    return false;
  });
  assert.equal(mountedInsideModal, true, 'The control must be inside the modal, not merely visible behind its top layer.');
  await quoteButton(page).click();
  assert.match(await settledText(page, '#secondary-editor', /Fragmento de la respuesta en hilo/),
    /> Fragmento de la respuesta en hilo\./);
  assert.equal(await page.locator('#prompt-textarea').inputValue(), primaryDraft);
});

test('generic inline section scopes a message to its local reply composer without a dialog or aside', async t => {
  const inline = `<section id="surface">${replyMessage}<form>
    <div id="secondary-editor" contenteditable="true" role="textbox" aria-label="Reply">${replyDraft}</div>
    <button type="submit" data-fixture-send>Send reply</button></form></section>`;
  const page = await fixture(t, primaryForm, inline);
  await page.locator('#prompt-textarea').fill(primaryDraft);
  await quote(page, '#reply-passage');
  const text = await settledText(page, '#secondary-editor', /Fragmento de la respuesta en hilo/);
  assert.ok(text.startsWith(replyDraft));
  assert.match(text, /> Fragmento de la respuesta en hilo\./);
  assert.equal(await page.locator('#prompt-textarea').inputValue(), primaryDraft);
});

test('one selection crossing primary and reply scopes is rejected, including the keyboard shortcut', async t => {
  const outside = `<aside id="surface">${replyMessage}
    <textarea id="secondary-editor" aria-label="Reply">${replyDraft}</textarea></aside>`;
  const page = await fixture(t, primaryForm, '', undefined, outside);
  await page.locator('#prompt-textarea').fill(primaryDraft);
  await page.locator('#passage-one').click();
  await page.evaluate(() => {
    const start = document.querySelector('#passage-one').firstChild;
    const end = document.querySelector('#reply-passage').firstChild;
    const range = document.createRange();
    range.setStart(start, 0);
    range.setEnd(end, end.textContent.length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.querySelector('#reply-passage').dispatchEvent(new PointerEvent('pointerup', {
      bubbles: true, pointerType: 'mouse',
    }));
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page.waitForTimeout(250);
  assert.equal(await quoteButton(page).isVisible(), false);
  await page.keyboard.press('Alt+Shift+Q');
  await page.waitForTimeout(150);
  assert.equal(await page.locator('#prompt-textarea').inputValue(), primaryDraft);
  assert.equal(await page.locator('#secondary-editor').inputValue(), replyDraft);
});

test('hiding a reply invalidates its pending quote immediately without a URL change', async t => {
  const outside = `<aside id="surface">${replyMessage}
    <textarea id="secondary-editor" aria-label="Reply">${replyDraft}</textarea></aside>`;
  const page = await fixture(t, primaryForm, '', undefined, outside);
  await page.locator('#prompt-textarea').fill(primaryDraft);
  await select(page, '#reply-passage');
  await quoteButton(page).evaluate(button => {
    // Click synchronously before MutationObserver can hide a stale control.
    // Handler-side scope validation, not a timer, must protect the draft.
    document.querySelector('#surface').hidden = true;
    button.click();
  });
  await page.waitForTimeout(200);
  assert.equal(page.url(), fixtureURL);
  assert.equal(await page.locator('#prompt-textarea').inputValue(), primaryDraft);
  assert.equal(await page.locator('#secondary-editor').inputValue(), replyDraft);
});

test('replacing a reply at the same URL cannot insert a stale selection into the replacement', async t => {
  const outside = `<aside id="surface">${replyMessage}
    <textarea id="secondary-editor" aria-label="Reply">${replyDraft}</textarea></aside>`;
  const page = await fixture(t, primaryForm, '', undefined, outside);
  await page.locator('#prompt-textarea').fill(primaryDraft);
  await select(page, '#reply-passage');
  await quoteButton(page).evaluate(button => {
    const previous = document.querySelector('#surface');
    const replacement = previous.cloneNode(true);
    replacement.querySelector('#secondary-editor').value = 'Borrador de otro hilo.';
    replacement.querySelector('#reply-passage').textContent = 'Mensaje de otro hilo.';
    previous.replaceWith(replacement);
    button.click();
  });
  await page.waitForTimeout(200);
  assert.equal(page.url(), fixtureURL);
  assert.equal(await page.locator('#prompt-textarea').inputValue(), primaryDraft);
  assert.equal(await page.locator('#secondary-editor').inputValue(), 'Borrador de otro hilo.');
});
