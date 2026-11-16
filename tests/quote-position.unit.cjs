/*
 * Offline geometry tests against helpers extracted from the distributed
 * userscript, not copied implementations. No browser, network, layout engine,
 * credentials, or real ChatGPT/Dots page is used by this suite.
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

function helpers(extra = {}, names = []) {
  const context = vm.createContext(extra);
  for (const name of ['intersectRects', 'floatingPosition', 'overlayScale', 'toOverlayCoordinates', ...names]) {
    context[name] = vm.runInContext(`(${helperSource(name)})`, context, { timeout: 1000 });
  }
  return context;
}

function rect(left, top, width, height) {
  return { left, top, right: left + width, bottom: top + height, width, height };
}

function plain(value) { return JSON.parse(JSON.stringify(value)); }

function assertNear(actual, expected) {
  assert.ok(Number.isFinite(actual), `Expected finite coordinate, got ${actual}`);
  assert.ok(Math.abs(actual - expected) < 1e-9, `Expected ${actual} to equal ${expected}`);
}

test('quote position: viewport and a shifted reply panel intersect in viewport coordinates', () => {
  const h = helpers();
  const panel = rect(760, 100, 360, 700);
  assert.deepEqual(plain(h.intersectRects([rect(0, 0, 1200, 900), panel])), panel);
});

test('quote position: a partially off-screen panel is clipped to the viewport', () => {
  const h = helpers();
  const result = h.intersectRects([rect(0, 0, 1200, 900), rect(900, -25, 400, 700)]);
  assert.deepEqual(plain(result), rect(900, 0, 300, 675));
});

test('quote position: viewport and multiple clipping rectangles all constrain the area', () => {
  const h = helpers();
  const result = h.intersectRects([
    rect(0, 0, 1200, 900), rect(700, 100, 400, 700), rect(650, 170, 400, 420),
  ]);
  assert.deepEqual(plain(result), rect(700, 170, 350, 420));
});

for (const [kind, other] of [
  ['disjoint', rect(110, 0, 100, 100)],
  ['touching edges', rect(100, 0, 100, 100)],
  ['zero width', rect(50, 20, 0, 20)],
  ['zero height', rect(50, 20, 20, 0)],
]) {
  test(`quote position: ${kind} produces no usable intersection`, () => {
    const h = helpers();
    assert.equal(h.intersectRects([rect(0, 0, 100, 100), other]), null);
  });
}

test('quote position: the bar prefers the space below the selection', () => {
  const h = helpers();
  const point = h.floatingPosition(rect(720, 240, 40, 20), { width: 180, height: 40 }, rect(600, 80, 560, 720));
  assert.deepEqual(plain(point), { x: 720, y: 270 });
});

test('quote position: right-edge selections are clamped inside the reply area', () => {
  const h = helpers();
  const point = h.floatingPosition(rect(1152, 240, 5, 20), { width: 180, height: 40 }, rect(600, 80, 560, 720));
  assert.deepEqual(plain(point), { x: 972, y: 270 });
});

test('quote position: left-edge selections retain the area margin', () => {
  const h = helpers();
  const point = h.floatingPosition(rect(550, 240, 20, 20), { width: 180, height: 40 }, rect(600, 80, 560, 720));
  assert.deepEqual(plain(point), { x: 608, y: 270 });
});

test('quote position: selections near the bottom flip the bar above the text', () => {
  const h = helpers();
  const point = h.floatingPosition(rect(750, 770, 20, 18), { width: 180, height: 40 }, rect(600, 80, 560, 720));
  assert.deepEqual(plain(point), { x: 750, y: 720 });
});

test('quote position: a tall selection still places a fitting bar inside the area', () => {
  const h = helpers();
  const area = rect(600, 80, 560, 720);
  const size = { width: 180, height: 40 };
  const point = h.floatingPosition(rect(640, 100, 50, 650), size, area);
  assert.ok(point);
  assert.ok(point.x >= area.left + 8 && point.x + size.width <= area.right - 8);
  assert.ok(point.y >= area.top + 8 && point.y + size.height <= area.bottom - 8);
});

test('quote position: a one-pixel-wide text anchor does not narrow the floating bar', () => {
  const h = helpers();
  const size = { width: 180, height: 40 };
  const area = rect(600, 80, 560, 720);
  const point = h.floatingPosition(rect(720, 240, 1, 20), size, area);
  assert.deepEqual(plain(point), { x: 720, y: 270 });
  assert.deepEqual(plain(point), plain(h.floatingPosition(rect(720, 240, 80, 20), size, area)));
});

for (const [kind, area] of [
  ['empty width', rect(600, 80, 0, 720)],
  ['empty height', rect(600, 80, 560, 0)],
  ['too narrow including margins', rect(600, 80, 195, 720)],
  ['too short including margins', rect(600, 80, 560, 55)],
]) {
  test(`quote position: ${kind} rejects a bar that cannot fit`, () => {
    const h = helpers();
    assert.equal(h.floatingPosition(rect(720, 240, 40, 20), { width: 180, height: 40 }, area), null);
  });
}

test('quote position: an exactly fitting area is accepted with margins', () => {
  const h = helpers();
  const point = h.floatingPosition(rect(720, 240, 40, 20), { width: 180, height: 40 }, rect(600, 80, 196, 56));
  assert.deepEqual(plain(point), { x: 608, y: 88 });
});

test('quote position: explicit margin and gap are applied in viewport coordinates', () => {
  const h = helpers();
  const point = h.floatingPosition(rect(550, 240, 20, 20), { width: 180, height: 40 }, rect(600, 80, 560, 720), 12, 6);
  assert.deepEqual(plain(point), { x: 612, y: 266 });
});

for (const [name, sx, sy] of [
  ['unscaled', 1, 1],
  ['80 percent scale', 0.8, 0.8],
  ['125 percent scale', 1.25, 1.25],
  ['non-uniform scale', 0.8, 1.25],
]) {
  test(`quote position: ${name} converts viewport coordinates without duplicating panel offsets`, () => {
    const h = helpers();
    const hostSize = { width: 500, height: 600 };
    const hostRect = rect(640, 100, hostSize.width * sx, hostSize.height * sy);
    const scale = h.overlayScale(hostRect, hostSize);
    assert.ok(scale);
    assertNear(scale.x, sx);
    assertNear(scale.y, sy);
    const point = { x: 720, y: 270 };
    const local = h.toOverlayCoordinates(point, hostRect, scale);
    assertNear(local.left, (point.x - hostRect.left) / sx);
    assertNear(local.top, (point.y - hostRect.top) / sy);
    assertNear(hostRect.left + local.left * sx, point.x);
    assertNear(hostRect.top + local.top * sy, point.y);
  });
}

for (const [name, hostRect, hostSize] of [
  ['zero layout width', rect(600, 80, 500, 600), { width: 0, height: 600 }],
  ['zero layout height', rect(600, 80, 500, 600), { width: 500, height: 0 }],
  ['zero rendered width', rect(600, 80, 0, 600), { width: 500, height: 600 }],
  ['zero rendered height', rect(600, 80, 500, 0), { width: 500, height: 600 }],
  ['negative rendered width', rect(600, 80, -500, 600), { width: 500, height: 600 }],
  ['negative layout height', rect(600, 80, 500, 600), { width: 500, height: -600 }],
  ['non-finite rendered width', rect(600, 80, Infinity, 600), { width: 500, height: 600 }],
  ['non-finite layout height', rect(600, 80, 500, 600), { width: 500, height: Infinity }],
  ['not-a-number width', rect(600, 80, NaN, 600), { width: 500, height: 600 }],
  ['overflowing ratio from finite dimensions', rect(600, 80, Number.MAX_VALUE, 600), { width: Number.MIN_VALUE, height: 600 }],
  ['underflowing ratio from finite dimensions', rect(600, 80, Number.MIN_VALUE, 600), { width: Number.MAX_VALUE, height: 600 }],
]) {
  test(`quote position: ${name} rejects an unusable overlay scale`, () => {
    const h = helpers();
    assert.equal(h.overlayScale(hostRect, hostSize), null);
  });
}

test('quote position: fractional viewport positions survive the scale round trip', () => {
  const h = helpers();
  const hostRect = rect(637.25, 83.625, 400, 750);
  const scale = h.overlayScale(hostRect, { width: 500, height: 600 });
  const point = { x: 749.875, y: 226.375 };
  const local = h.toOverlayCoordinates(point, hostRect, scale);
  assertNear(hostRect.left + local.left * scale.x, point.x);
  assertNear(hostRect.top + local.top * scale.y, point.y);
});

/*
 * This deliberately small integration harness supplies measured rectangles and
 * the CSS-pixel-to-viewport transform. It is not a DOM or CSS layout engine: the
 * custom wrapping measurement below is an explicit synthetic test condition.
 */
function positionFixture({
  panelRect = rect(640, 100, 500, 600),
  hostRect = panelRect,
  hostSize = { width: 500, height: 600 },
  barSize = { width: 180, height: 40 },
  lineRects = [rect(720, 240, 40, 20)],
  scopeRect = panelRect,
  visualViewport = null,
  measure = width => ({ width, height: barSize.height }),
} = {}) {
  const body = { parentElement: null };
  const boundary = { parentElement: body, getBoundingClientRect: () => panelRect };
  const scope = { parentElement: boundary, getBoundingClientRect: () => scopeRect };
  const host = {
    parentElement: boundary,
    offsetWidth: hostSize.width,
    offsetHeight: hostSize.height,
    getBoundingClientRect: () => hostRect,
  };
  const measurements = [];
  const bar = {
    hidden: true,
    style: { left: '11px', top: '22px', maxWidth: '', visibility: '' },
    getBoundingClientRect() {
      const maxWidth = Number.parseFloat(this.style.maxWidth);
      const constrainedWidth = Math.min(barSize.width, Number.isFinite(maxWidth) ? maxWidth : barSize.width);
      const local = measure(constrainedWidth);
      const sx = hostRect.width / host.offsetWidth;
      const sy = hostRect.height / host.offsetHeight;
      measurements.push({ ...this.style, hidden: this.hidden, width: local.width, height: local.height });
      return rect(
        hostRect.left + Number.parseFloat(this.style.left) * sx,
        hostRect.top + Number.parseFloat(this.style.top) * sy,
        local.width * sx,
        local.height * sy,
      );
    },
  };
  const snapshot = {
    scope, boundary,
    range: { getClientRects: () => lineRects },
    // Intentionally stale: positioning must read the current selected range.
    rect: rect(0, 0, 1, 1),
  };
  const context = helpers({
    document: { body }, host, bar,
    window: { innerWidth: 1200, innerHeight: 900, visualViewport },
  }, ['floatingBounds', 'positionBar']);
  return { context, snapshot, bar, host, measurements };
}

test('quote position integration: a shifted host uses local offsets, not viewport coordinates twice', () => {
  const f = positionFixture();
  assert.equal(f.context.positionBar(f.snapshot), true);
  assert.equal(f.bar.style.left, '80px');
  assert.equal(f.bar.style.top, '170px');
  assert.equal(f.bar.style.maxWidth, '483px');
  assert.equal(f.bar.style.visibility, '');
  assert.equal(f.bar.hidden, false);
  assert.deepEqual(f.bar.getBoundingClientRect(), rect(720, 270, 180, 40));
});

for (const [name, sx, sy] of [
  ['80 percent', 0.8, 0.8],
  ['125 percent', 1.25, 1.25],
  ['non-uniform', 0.8, 1.25],
]) {
  test(`quote position integration: ${name} host scale preserves the viewport placement`, () => {
    const f = positionFixture({ panelRect: rect(640, 100, 500 * sx, 600 * sy) });
    assert.equal(f.context.positionBar(f.snapshot), true);
    assertNear(Number.parseFloat(f.bar.style.left), 80 / sx);
    assertNear(Number.parseFloat(f.bar.style.top), 170 / sy);
    const box = f.bar.getBoundingClientRect();
    assertNear(box.left, 720);
    assertNear(box.top, 270);
    assertNear(box.width, 180 * sx);
    assertNear(box.height, 40 * sy);
    const area = f.context.floatingBounds(f.snapshot);
    assertNear(Number.parseFloat(f.bar.style.maxWidth), (area.width - 17) / sx);
  });
}

test('quote position integration: right-edge clamping uses the scaled rendered bar width', () => {
  const f = positionFixture({
    panelRect: rect(640, 100, 400, 480),
    lineRects: [rect(1035, 240, 10, 20)],
  });
  assert.equal(f.context.positionBar(f.snapshot), true);
  const box = f.bar.getBoundingClientRect();
  assertNear(box.left, 888);
  assertNear(box.top, 270);
  assertNear(box.right, 1032);
  assertNear(Number.parseFloat(f.bar.style.left), 310);
});

test('quote position integration: width limiting is measured before wrapped height chooses above or below', () => {
  const f = positionFixture({
    panelRect: rect(640, 100, 224, 280),
    hostSize: { width: 224, height: 280 },
    barSize: { width: 260, height: 40 },
    lineRects: [rect(680, 300, 20, 20)],
    measure: width => ({ width, height: width < 240 ? 80 : 40 }),
  });
  assert.equal(f.context.positionBar(f.snapshot), true);
  assert.equal(f.measurements.length, 1);
  assert.deepEqual(f.measurements[0], {
    left: '0px', top: '0px', maxWidth: '207px', visibility: 'hidden', hidden: false, width: 207, height: 80,
  });
  // A pre-wrap height of 40 would incorrectly fit below at y=330. The actual
  // wrapped height of 80 must instead be measured and placed above at y=210.
  assert.deepEqual(f.bar.getBoundingClientRect(), rect(649, 210, 207, 80));
});

test('quote position integration: visual viewport offsets constrain the visible reply area', () => {
  const f = positionFixture({
    visualViewport: { offsetLeft: 700, offsetTop: 200, width: 350, height: 350 },
    lineRects: [rect(680, 510, 60, 20)],
  });
  assert.deepEqual(plain(f.context.floatingBounds(f.snapshot)), rect(700, 200, 350, 350));
  assert.equal(f.context.positionBar(f.snapshot), true);
  assert.equal(f.bar.style.maxWidth, '333px');
  assert.deepEqual(f.bar.getBoundingClientRect(), rect(708, 460, 180, 40));
});

test('quote position integration: a subpixel layout rounding increase does not hide a width-limited bar', () => {
  const f = positionFixture({
    panelRect: rect(640, 100, 224, 280),
    hostSize: { width: 224, height: 280 },
    barSize: { width: 260, height: 40 },
    lineRects: [rect(680, 300, 20, 20)],
    // Model a layout engine returning a slightly larger rendered box after
    // max-width is quantized. Filling the available width exactly fails here.
    measure: width => ({ width: width + 0.04, height: 80 }),
  });
  assert.equal(f.context.positionBar(f.snapshot), true);
  const bounds = f.bar.getBoundingClientRect();
  const area = f.context.floatingBounds(f.snapshot);
  assert.ok(bounds.left >= area.left + 8 - 1e-9);
  assert.ok(bounds.right <= area.right - 8 + 1e-9);
  assert.equal(f.bar.hidden, false);
});

test('quote position integration: the last visible line is used instead of an off-screen final line', () => {
  const f = positionFixture({ lineRects: [rect(720, 240, 40, 20), rect(770, 300, 40, 20), rect(720, 800, 40, 20)] });
  assert.equal(f.context.positionBar(f.snapshot), true);
  assert.deepEqual(f.bar.getBoundingClientRect(), rect(770, 330, 180, 40));
});

test('quote position integration: a boxless scope inherits its nearest boxed ancestor bounds', () => {
  const f = positionFixture({ scopeRect: rect(0, 0, 0, 0) });
  assert.deepEqual(plain(f.context.floatingBounds(f.snapshot)), rect(640, 100, 500, 600));
  assert.equal(f.context.positionBar(f.snapshot), true);
  assert.deepEqual(f.bar.getBoundingClientRect(), rect(720, 270, 180, 40));
});

for (const [name, overrides] of [
  ['no visible text line', { lineRects: [rect(720, 800, 40, 20)] }],
  ['zero host layout width', { hostSize: { width: 0, height: 600 } }],
  ['an area no wider than the margins', { panelRect: rect(640, 100, 16, 600) }],
]) {
  test(`quote position integration: ${name} produces no floating bar`, () => {
    const f = positionFixture(overrides);
    assert.equal(f.context.positionBar(f.snapshot), false);
    assert.equal(f.bar.hidden, true);
    assert.equal(f.measurements.length, 0);
  });
}

test('quote position integration: a measured bar too tall for the panel is hidden cleanly', () => {
  const f = positionFixture({
    panelRect: rect(640, 100, 224, 100),
    hostSize: { width: 224, height: 100 },
    barSize: { width: 260, height: 40 },
    lineRects: [rect(680, 120, 20, 20)],
    measure: width => ({ width, height: 120 }),
  });
  assert.equal(f.context.positionBar(f.snapshot), false);
  assert.equal(f.measurements.length, 1);
  assert.equal(f.bar.hidden, true);
  assert.equal(f.bar.style.visibility, '');
});
