// Pruebas del hover (fase 5): lógica pura con probe y temporizadores simulados.
import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  createFailureMemo,
  createFrameCache,
  createHoverPreview,
  resolveFrames,
  type ImageProbe,
  type PreviewState,
} from "../src/lib/hoverPreview.ts";
import type { ChannelEntry } from "../src/types.ts";

const entry = (over: Partial<ChannelEntry> = {}): ChannelEntry => ({
  id: "s1", url: "u", section: "shorts", width: 405, height: 720,
  coverUrl: "c", frames: ["c", "f1", "f2", "f3"], animatedUrl: null, ...over,
});
const ok = (w = 405): ImageProbe => async () => ({ width: w, height: w * 1.8 });
const only = (good: string[]): ImageProbe => async (u) => (good.includes(u) ? { width: 405, height: 720 } : null);
const flush = () => new Promise((r) => setImmediate(r));

describe("resolveFrames", () => {
  it("descarta inexistentes y placeholders pequeños; conserva el orden", async () => {
    const probe: ImageProbe = async (u) =>
      u === "f1" ? { width: 405, height: 720 } : u === "f2" ? { width: 120, height: 90 } : null;
    const r = await resolveFrames(entry(), probe, new AbortController().signal, createFrameCache());
    assert.deepEqual(r, ["c", "f1"]);
  });
  it("ninguno válido -> [] y se cachea (no re-sondea)", async () => {
    let calls = 0;
    const probe: ImageProbe = async () => (calls++, null);
    const cache = createFrameCache();
    assert.deepEqual(await resolveFrames(entry(), probe, new AbortController().signal, cache), []);
    const n = calls;
    assert.deepEqual(await resolveFrames(entry(), probe, new AbortController().signal, cache), []);
    assert.equal(calls, n);
  });
  it("abortado: no cachea", async () => {
    const c = new AbortController();
    const cache = createFrameCache();
    const p = resolveFrames(entry(), async () => (c.abort(), { width: 405, height: 720 }), c.signal, cache);
    assert.deepEqual(await p, []);
    assert.equal(cache.size, 0);
  });
  it("LRU: expulsa el menos usado", () => {
    const c = createFrameCache(2);
    c.set("a", ["1"]); c.set("b", ["2"]); c.get("a"); c.set("c", ["3"]);
    assert.ok(c.get("a") && c.get("c") && !c.get("b"));
  });
});

describe("createHoverPreview", () => {
  it("short: espera el delay, muestra frames[1] y alterna en bucle", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    const seen: PreviewState[] = [];
    const h = createHoverPreview(entry(), (s) => seen.push(s), { probe: ok(), cache: createFrameCache(), delay: 250, interval: 700 });
    h.start();
    t.mock.timers.tick(249);
    await flush();
    assert.equal(seen.length, 0);
    t.mock.timers.tick(1);
    await flush();
    assert.deepEqual(seen, [{ kind: "frame", url: "f1" }]);
    t.mock.timers.tick(700 * 3);
    assert.deepEqual(seen.slice(1).map((s) => s!.url), ["f2", "f3", "c"]);
    t.mock.timers.tick(700);
    assert.equal(seen.at(-1)!.url, "f1");
    h.stop();
    assert.equal(seen.at(-1), null);
    const n = seen.length;
    t.mock.timers.tick(5000);
    assert.equal(seen.length, n); // el bucle se detuvo
  });
  it("salir antes del delay: no descarga nada ni emite", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    let probed = 0;
    const seen: PreviewState[] = [];
    const h = createHoverPreview(entry(), (s) => seen.push(s), { probe: async () => (probed++, null), cache: createFrameCache() });
    h.start(); t.mock.timers.tick(100); h.stop(); t.mock.timers.tick(1000); await flush();
    assert.equal(probed, 0);
    assert.deepEqual(seen, [null]);
  });
  it("video: muestra el webp animado solo cuando cargó", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    const seen: PreviewState[] = [];
    const e = entry({ section: "videos", frames: [], animatedUrl: "a.webp" });
    const h = createHoverPreview(e, (s) => seen.push(s), { probe: ok(320), delay: 10 });
    h.start(); t.mock.timers.tick(10); await flush();
    assert.deepEqual(seen, [{ kind: "animated", url: "a.webp" }]);
  });
  it("video con webp roto: reintenta una vez, no muestra nada y avisa del fallo", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    const seen: PreviewState[] = [];
    const fails: string[] = [];
    let calls = 0;
    const h = createHoverPreview(entry({ section: "videos", frames: [], animatedUrl: "a.webp" }), (s) => seen.push(s), {
      probe: async () => (calls++, null), failed: createFailureMemo(), delay: 10, retryMs: 400,
      onFail: (k, _e, r) => fails.push(`${k}:${r}`),
    });
    h.start(); t.mock.timers.tick(10); await flush();
    assert.equal(calls, 1);
    t.mock.timers.tick(400); await flush();
    assert.equal(calls, 2);
    assert.deepEqual(seen, []);
    assert.deepEqual(fails, ["animated:no cargó"]);
  });
  it("fallo transitorio: el segundo intento rescata el webp", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    const seen: PreviewState[] = [];
    let calls = 0;
    const h = createHoverPreview(entry({ section: "videos", frames: [], animatedUrl: "a.webp" }), (s) => seen.push(s), {
      probe: async () => (calls++ === 0 ? null : { width: 320, height: 180 }), failed: createFailureMemo(), delay: 10, retryMs: 400,
    });
    h.start(); t.mock.timers.tick(10); await flush(); t.mock.timers.tick(400); await flush();
    assert.deepEqual(seen, [{ kind: "animated", url: "a.webp" }]);
  });
  it("webp 'cargado' pero diminuto (placeholder): se rechaza", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    const seen: PreviewState[] = [];
    const fails: string[] = [];
    const h = createHoverPreview(entry({ section: "videos", frames: [], animatedUrl: "a.webp" }), (s) => seen.push(s), {
      probe: async () => ({ width: 1, height: 1 }), failed: createFailureMemo(), delay: 10, retryMs: 5,
      onFail: (_k, _e, r) => fails.push(r),
    });
    h.start(); t.mock.timers.tick(10); await flush(); t.mock.timers.tick(5); await flush();
    assert.deepEqual(seen, []);
    assert.match(fails[0], /demasiado pequeño/);
  });
  it("descarga colgada: timeout, sin reintento, y no aparece tarde", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    const seen: PreviewState[] = [];
    const fails: string[] = [];
    let calls = 0;
    const hang: ImageProbe = (_u, signal) => new Promise((res) => { calls++; signal.addEventListener("abort", () => res(null)); });
    const h = createHoverPreview(entry({ section: "videos", frames: [], animatedUrl: "a.webp" }), (s) => seen.push(s), {
      probe: hang, failed: createFailureMemo(), delay: 10, timeoutMs: 8000, onFail: (_k, _e, r) => fails.push(r),
    });
    h.start(); t.mock.timers.tick(10); await flush(); t.mock.timers.tick(8000); await flush();
    assert.equal(calls, 1);
    assert.deepEqual(fails, ["timeout"]);
    assert.deepEqual(seen, []);
  });
  it("tras un fallo, el siguiente hover no reintenta ni muestra 'cargando' (hasta el TTL)", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    let clock = 0;
    const failed = createFailureMemo(60_000, () => clock);
    let calls = 0;
    const loading: boolean[] = [];
    const mk = () => createHoverPreview(entry({ section: "videos", frames: [], animatedUrl: "a.webp" }), () => {}, {
      probe: async () => (calls++, null), failed, delay: 10, retryMs: 1, onLoading: (v) => loading.push(v),
    });
    const h = mk();
    h.start(); t.mock.timers.tick(10); await flush(); t.mock.timers.tick(1); await flush(); h.stop();
    assert.equal(calls, 2);
    const h2 = mk();
    h2.start(); t.mock.timers.tick(10); await flush();
    assert.equal(calls, 2); // no volvió a probar
    h2.stop();
    clock = 60_001;
    const h3 = mk();
    h3.start(); t.mock.timers.tick(10); await flush();
    assert.equal(calls, 3); // pasó el TTL: reintenta
  });
  it("animación inservible con frames disponibles: cae a los frames", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    const seen: PreviewState[] = [];
    const probe: ImageProbe = async (u) => (u === "a.webp" ? null : { width: 405, height: 720 });
    const h = createHoverPreview(entry({ animatedUrl: "a.webp" }), (s) => seen.push(s), {
      probe, failed: createFailureMemo(), cache: createFrameCache(), delay: 10, retryMs: 1,
    });
    h.start(); t.mock.timers.tick(10); await flush(); t.mock.timers.tick(1); await flush(); await flush();
    assert.deepEqual(seen, [{ kind: "frame", url: "f1" }]);
  });
  it("onLoading: true al empezar a descargar, false al terminar o salir", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    const loading: boolean[] = [];
    const h = createHoverPreview(entry({ section: "videos", frames: [], animatedUrl: "a.webp" }), () => {}, {
      probe: ok(320), failed: createFailureMemo(), delay: 10, onLoading: (v) => loading.push(v),
    });
    h.start(); t.mock.timers.tick(10); await flush();
    assert.deepEqual(loading, [true, false]);
  });
  it("lee la entry vigente (refreshItems la reemplaza)", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    let e = entry({ section: "videos", frames: [], animatedUrl: "old.webp" });
    const seen: PreviewState[] = [];
    const h = createHoverPreview(() => e, (s) => seen.push(s), { probe: ok(320), failed: createFailureMemo(), delay: 10 });
    e = { ...e, animatedUrl: "new.webp" };
    h.start(); t.mock.timers.tick(10); await flush();
    assert.deepEqual(seen, [{ kind: "animated", url: "new.webp" }]);
  });
  it("salir con el webp en descarga: la respuesta tardía se ignora", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    const seen: PreviewState[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const h = createHoverPreview(entry({ section: "videos", frames: [], animatedUrl: "a.webp" }), (s) => seen.push(s), { probe: async () => (await gate, { width: 1, height: 1 }), delay: 10 });
    h.start(); t.mock.timers.tick(10); h.stop(); release(); await flush();
    assert.deepEqual(seen, [null]);
  });
  it("sin nada que mostrar (video sin animated, short sin frames): start no hace nada", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    const seen: PreviewState[] = [];
    for (const e of [entry({ section: "videos", frames: [], animatedUrl: null }), entry({ frames: [] })]) {
      const h = createHoverPreview(e, (s) => seen.push(s), { probe: ok() });
      h.start(); t.mock.timers.tick(1000); h.stop();
    }
    assert.deepEqual(seen, []);
  });
  it("reducedMotion: short = un cambio estático sin bucle; video = nada", async (t) => {
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    const seen: PreviewState[] = [];
    const h = createHoverPreview(entry(), (s) => seen.push(s), { probe: only(["f1", "f2"]), cache: createFrameCache(), delay: 10, reducedMotion: true });
    h.start(); t.mock.timers.tick(10); await flush(); t.mock.timers.tick(5000);
    assert.deepEqual(seen, [{ kind: "frame", url: "f1" }]);
    const v: PreviewState[] = [];
    const hv = createHoverPreview(entry({ frames: [], animatedUrl: "a" }), (s) => v.push(s), { probe: ok(), delay: 10, reducedMotion: true });
    hv.start(); t.mock.timers.tick(10); await flush();
    assert.deepEqual(v, []);
  });
});
