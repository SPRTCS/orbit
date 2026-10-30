import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.__DEV__ = false;
const model = await import("./model.ts");
const { captureScript } = await import("./pageScript.ts");

const metrics = ({ cssWidth = 1163, cssHeight = 806, zoom = 1, dsf = 2, contentWidth = 1163, contentHeight = 5000 } = {}) => ({
  cssVisualViewport: { clientWidth: cssWidth, clientHeight: cssHeight, pageX: 0, pageY: 0, zoom, scale: 1 },
  visualViewport: { clientWidth: cssWidth * zoom * dsf, clientHeight: cssHeight * zoom * dsf, pageX: 0, pageY: 0, zoom, scale: 1 },
  cssContentSize: { width: contentWidth, height: contentHeight },
});

test("modes: region by default, the two named ones otherwise", () => {
  assert.equal(model.captureMode(null), "region");
  assert.equal(model.captureMode("region"), "region");
  assert.equal(model.captureMode("fullPage"), "fullPage");
  assert.equal(model.captureMode("visible"), "visible");
  assert.equal(model.captureMode("bogus"), "region");
});

test("zoom and device scale come from the layout metrics (measured: 1163 css → 2326 device at 2x, 775 css at 150%)", () => {
  assert.equal(model.pageZoom(metrics()), 1);
  assert.equal(model.deviceScale(metrics()), 2);
  const zoomed = { cssVisualViewport: { clientWidth: 775.3333740234375, zoom: 1.5, scale: 1 }, visualViewport: { clientWidth: 2326 } };
  assert.equal(model.pageZoom(zoomed), 1.5);
  assert.equal(model.deviceScale(zoomed), 2);
  assert.equal(model.deviceScale(metrics({ dsf: 1 })), 1);
  assert.equal(model.pageZoom({}), 1);
  assert.equal(model.deviceScale(null), 1);
  assert.equal(model.pageZoom({ cssVisualViewport: { zoom: 0 } }), 1);
});

test("a region is clipped in document coordinates at the page's zoom, at scale 1", () => {
  const view = { scrollX: 0, scrollY: 0 };
  assert.deepEqual(model.regionClip({ x: 100, y: 300, width: 200, height: 150 }, view, 1), { x: 100, y: 300, width: 200, height: 150, scale: 1 });
  assert.deepEqual(model.regionClip({ x: 0, y: 0, width: 300, height: 100 }, { scrollX: 0, scrollY: 1000 }, 1.5), {
    x: 0,
    y: 1500,
    width: 450,
    height: 150,
    scale: 1,
  });
  assert.deepEqual(model.regionClip({ x: 10.25, y: 20.5, width: 33.3333, height: 40 }, { scrollX: 5, scrollY: 7 }, 1.1), {
    x: 16.775,
    y: 30.25,
    width: 36.667,
    height: 44,
    scale: 1,
  });
});

test("a region hanging off the document's top-left is trimmed; empty ones are refused", () => {
  assert.deepEqual(model.regionClip({ x: -50, y: -20, width: 150, height: 120 }, { scrollX: 0, scrollY: 0 }, 1), { x: 0, y: 0, width: 100, height: 100, scale: 1 });
  assert.equal(model.regionClip({ x: -50, y: 0, width: 40, height: 40 }, { scrollX: 0, scrollY: 0 }, 1), null);
  assert.equal(model.regionClip({ x: 0, y: 0, width: 0.5, height: 40 }, { scrollX: 0, scrollY: 0 }, 1), null);
  assert.equal(model.regionClip({ x: 0, y: 0, width: 10, height: 10 }, { scrollX: 0, scrollY: 0 }, 0), null);
});

test("output pixels: the clip at device scale, so a 200×150 region is 400×300 on a 2x display and 600×450 at 150% zoom", () => {
  const plain = model.regionClip({ x: 100, y: 300, width: 200, height: 150 }, { scrollX: 0, scrollY: 0 }, 1);
  assert.deepEqual(model.outputSize(plain, 2), { width: 400, height: 300 });
  const zoomed = model.regionClip({ x: 100, y: 300, width: 200, height: 150 }, { scrollX: 0, scrollY: 0 }, 1.5);
  assert.deepEqual(model.outputSize(zoomed, 2), { width: 600, height: 450 });
});

test("elements wholly in the viewport skip captureBeyondViewport", () => {
  const view = { innerWidth: 1163, innerHeight: 806 };
  assert.equal(model.insideViewport({ x: 0, y: 0, width: 1163, height: 806 }, view), true);
  assert.equal(model.insideViewport({ x: 10, y: 700, width: 100, height: 200 }, view), false);
  assert.equal(model.insideViewport({ x: 10, y: -1, width: 100, height: 20 }, view), false);
});

test("full page: the whole content at full resolution when it fits (measured 2326×10000 for a 5000 px page at 2x)", () => {
  const full = model.fullPageClip(metrics());
  assert.deepEqual(full, { clip: { x: 0, y: 0, width: 1163, height: 5000, scale: 1 }, cropped: false });
  assert.deepEqual(model.outputSize(full.clip, 2), { width: 2326, height: 10000 });
  const zoomed = model.fullPageClip(metrics({ cssWidth: 775, zoom: 1.5, contentWidth: 775 }));
  assert.deepEqual(zoomed.clip, { x: 0, y: 0, width: 1162.5, height: 7500, scale: 1 });
});

test("full page: a taller page is scaled down to the texture limit, then cut below half scale", () => {
  const tall = model.fullPageClip(metrics({ contentHeight: 12000 }));
  assert.equal(tall.cropped, false);
  const size = model.outputSize(tall.clip, 2);
  assert.ok(size.height <= model.MAX_CAPTURE_SIDE && size.height >= model.MAX_CAPTURE_SIDE - 2, `${size.height}`);
  assert.equal(tall.clip.height, 12000);
  const huge = model.fullPageClip(metrics({ contentHeight: 100000 }));
  assert.equal(huge.cropped, true);
  assert.equal(huge.clip.scale, model.MIN_FULL_PAGE_SCALE);
  assert.equal(huge.clip.height, model.MAX_CAPTURE_SIDE);
  assert.ok(model.outputSize(huge.clip, 2).height <= model.MAX_CAPTURE_SIDE);
  assert.equal(model.fullPageClip({}), null);
  assert.equal(model.fullPageClip(metrics({ contentHeight: 0 })), null);
});

test("file names follow macOS's screenshot names, with (n) for copies", () => {
  const date = new Date(2026, 9, 30, 9, 5, 7);
  assert.equal(model.captureFileName(date), "Orbit Capture 2026-10-30 at 09.05.07.png");
  assert.equal(model.captureFileName(date, 2), "Orbit Capture 2026-10-30 at 09.05.07 (2).png");
  assert.ok(!/[:/]/.test(model.captureFileName(date)));
  const taken = new Set(["Orbit Capture 2026-10-30 at 09.05.07.png", "Orbit Capture 2026-10-30 at 09.05.07 (2).png"]);
  assert.equal(model.freeFileName(date, (n) => taken.has(n)), "Orbit Capture 2026-10-30 at 09.05.07 (3).png");
  assert.equal(model.freeFileName(date, () => false), "Orbit Capture 2026-10-30 at 09.05.07.png");
  assert.equal(model.freeFileName(date, () => true, 3), null);
});

test("the overlay script parses, and stopping it is a separate small script", () => {
  const body = captureScript("k1", {});
  assert.doesNotThrow(() => new Function("post", body));
  const stop = captureScript("k1", { stop: true });
  assert.doesNotThrow(() => new Function("post", stop));
  assert.ok(body.includes("Escape") && body.includes("elementsFromPoint"));
});

test("stop with no overlay answers stopped", () => {
  const answers = [];
  const window = {};
  const run = new Function("post", "window", captureScript("k2", { stop: true }));
  run((kind, json) => answers.push([kind, JSON.parse(json)]), window);
  assert.deepEqual(answers, [["result", { kind: "stopped" }]]);
});

function overlayPage() {
  const made = [];
  const windowListeners = new Map();
  const make = (name) => {
    const el = {
      localName: name,
      style: {},
      className: "",
      textContent: "",
      listeners: new Map(),
      children: [],
      offsetWidth: 60,
      rect: { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 },
      setAttribute() {},
      attachShadow() {
        return { append: (...nodes) => el.children.push(...nodes) };
      },
      append(...nodes) {
        el.children.push(...nodes);
      },
      appendChild(node) {
        el.children.push(node);
        node.attached = true;
      },
      remove() {
        el.attached = false;
      },
      focus() {},
      getBoundingClientRect() {
        return el.rect;
      },
      addEventListener(type, fn) {
        el.listeners.set(type, [...(el.listeners.get(type) ?? []), fn]);
      },
    };
    made.push(el);
    return el;
  };
  const body = make("body");
  const document = { createElement: make, body, documentElement: body, activeElement: body, elementsFromPoint: () => [] };
  const answers = [];
  const window = {};
  const globals = {
    window,
    document,
    addEventListener: (type, fn) => windowListeners.set(type, [...(windowListeners.get(type) ?? []), fn]),
    removeEventListener: (type, fn) => windowListeners.set(type, (windowListeners.get(type) ?? []).filter((f) => f !== fn)),
    requestAnimationFrame: (fn) => fn(),
    setTimeout: (fn) => fn(),
    getComputedStyle: () => ({ display: "block" }),
    innerWidth: 1163,
    innerHeight: 806,
    scrollX: 0,
    scrollY: 0,
    devicePixelRatio: 2,
  };
  const names = Object.keys(globals);
  const post = (kind, json) => answers.push(JSON.parse(json));
  new Function("post", ...names, captureScript("k3", {}))(post, ...names.map((n) => globals[n]));
  const host = made.find((el) => el.localName === "orbit-capture");
  const bar = made.find((el) => el.className === "bar");
  bar.rect = { left: 300, top: 16, right: 860, bottom: 54, width: 560, height: 38 };
  const button = (text) => made.find((el) => el.localName === "button" && el.textContent === text);
  const dispatch = (type, x, y, target) => {
    let stopped = false;
    const e = {
      type,
      clientX: x,
      clientY: y,
      button: 0,
      isTrusted: true,
      target: host,
      composedPath: () => [host, body],
      preventDefault() {},
      stopPropagation() {},
      stopImmediatePropagation() {
        stopped = true;
      },
    };
    for (const fn of windowListeners.get(type) ?? []) if (!stopped) fn(e);
    if (!stopped && target) for (const fn of target.listeners.get(type) ?? []) fn({ ...e, target });
  };
  const click = (x, y, target) => {
    dispatch("pointerdown", x, y, target);
    dispatch("mousedown", x, y, target);
    dispatch("pointerup", x, y, target);
    dispatch("mouseup", x, y, target);
    dispatch("click", x, y, target);
  };
  const settled = () => new Promise((resolve) => setImmediate(resolve));
  return { answers, button, click, dispatch, host, settled };
}

for (const [text, kind] of [
  ["Visible Area", "visible"],
  ["Full Page", "fullPage"],
  ["Cancel", "cancel"],
]) {
  test(`the bar's "${text}" button answers ${kind}, not an element pick (its listeners can't see inside the closed shadow root)`, async () => {
    const page = overlayPage();
    page.click(560, 35, page.button(text));
    await page.settled();
    assert.deepEqual(page.answers, [{ kind }]);
    assert.equal(page.host.attached, false);
  });
}

test("a drag that ends over the bar still captures the dragged area", async () => {
  const page = overlayPage();
  page.dispatch("pointerdown", 100, 300);
  page.dispatch("pointermove", 200, 200);
  page.dispatch("pointermove", 400, 40);
  page.dispatch("pointerup", 400, 40);
  await page.settled();
  assert.equal(page.answers.length, 1);
  assert.equal(page.answers[0].kind, "region");
  assert.deepEqual(page.answers[0].rect, { x: 100, y: 40, width: 300, height: 260 });
});

test("a click outside the bar on nothing pickable answers nothing", async () => {
  const page = overlayPage();
  page.click(560, 400, null);
  await page.settled();
  assert.deepEqual(page.answers, []);
  assert.equal(page.host.attached, true);
});
