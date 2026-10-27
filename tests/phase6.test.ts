// Fase 6: preferencias (tema/columnas) y breakpoints.
import assert from "node:assert/strict";
import { describe, it } from "vite-plus/test";
import { columnBreakpoints, columnsFor } from "../src/lib/layout.ts";
import { clampCols, DEFAULT_PREFS, loadPrefs, nextTheme, parsePrefs, PREFS_KEY, savePrefs } from "../src/lib/prefs.ts";

describe("prefs", () => {
  it("defaults: tema del sistema y 4 columnas", () => {
    assert.deepEqual(parsePrefs(null), { theme: "system", maxCols: 4, embed: true });
    assert.deepEqual(DEFAULT_PREFS, { theme: "system", maxCols: 4, embed: true });
  });
  it("clampCols: rango 2..6, redondea y cae a 4 con basura", () => {
    assert.equal(clampCols(1), 2);
    assert.equal(clampCols(9), 6);
    assert.equal(clampCols(3.6), 4);
    for (const bad of ["5", NaN, Infinity, null, undefined, {}]) assert.equal(clampCols(bad), 4);
  });
  it("parsePrefs tolera JSON roto y valores inválidos", () => {
    assert.deepEqual(parsePrefs("{nope"), DEFAULT_PREFS);
    assert.deepEqual(parsePrefs('{"theme":"neon","maxCols":99}'), { theme: "system", maxCols: 6, embed: true });
    assert.deepEqual(parsePrefs('{"theme":"dark","maxCols":3}'), { theme: "dark", maxCols: 3, embed: true });
    assert.deepEqual(parsePrefs("null"), DEFAULT_PREFS);
  });
  it("save/load ida y vuelta; un storage que lanza no rompe nada", () => {
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    savePrefs({ theme: "light", maxCols: 5, embed: false }, store);
    assert.ok(mem.has(PREFS_KEY));
    assert.deepEqual(loadPrefs(store), { theme: "light", maxCols: 5, embed: false });
    const boom = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("quota"); } };
    assert.deepEqual(loadPrefs(boom), DEFAULT_PREFS);
    assert.doesNotThrow(() => savePrefs(DEFAULT_PREFS, boom));
    assert.deepEqual(loadPrefs(null), DEFAULT_PREFS);
  });
  it("embed: por defecto activo; respeta false guardado; ignora basura", () => {
    assert.equal(parsePrefs(null).embed, true);
    assert.equal(parsePrefs('{"embed":false}').embed, false);
    assert.equal(parsePrefs('{"embed":"no"}').embed, true);
  });
  it("nextTheme cicla sistema -> claro -> oscuro", () => {
    assert.equal(nextTheme("system"), "light");
    assert.equal(nextTheme("light"), "dark");
    assert.equal(nextTheme("dark"), "system");
  });
});

describe("layout", () => {
  it("el tope limita las columnas, el responsive las reduce en pantallas chicas", () => {
    assert.equal(columnsFor(1800, 4), 4); // PC ancha: manda el tope (4 por defecto)
    assert.equal(columnsFor(1800, 6), 6);
    assert.equal(columnsFor(1200, 6), 5);
    assert.equal(columnsFor(900, 6), 4);
    assert.equal(columnsFor(600, 6), 3);
    assert.equal(columnsFor(390, 6), 2); // móvil: el tope no lo sube
    assert.equal(columnsFor(390, 4), 2);
    assert.equal(columnsFor(1800, 2), 2);
  });
  it("breakpoints: claves y valores válidos para el motor", () => {
    assert.deepEqual(columnBreakpoints(4), { 480: 2, 720: 3, 1024: 4, 1440: 4, Infinity: 4 });
    assert.deepEqual(columnBreakpoints(99), { 480: 2, 720: 3, 1024: 4, 1440: 5, Infinity: 6 });
  });
});
