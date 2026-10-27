// Pruebas de la búsqueda por título (lógica pura). node --test tests/
import assert from "node:assert/strict";
import { describe, it } from "vite-plus/test";
import { filterByTitle, matchesTitle, normalizeText, titleTerms } from "../src/lib/titleSearch.ts";
import { parseTitleFilter, toSearch, DEFAULT_QUERY, parseListQuery } from "../src/lib/urlState.ts";
import { toEntry } from "../src/lib/thumbs.ts";
import type { ChannelEntry, ChannelItem } from "../src/types.ts";

const entry = (id: string, title: string): ChannelEntry => ({
  id, url: `u/${id}`, title, section: "videos", width: 0, height: 0,
  coverUrl: null, frames: [], animatedUrl: null,
});
const list = [
  entry("a", "El gato rojo"),
  entry("b", "Camión de bomberos"),
  entry("c", "GATO y perro"),
  entry("d", ""),
  entry("e", "Canción: ¿Qué será?"),
];
const ids = (xs: ChannelEntry[]) => xs.map((e) => e.id);

describe("normalizeText / titleTerms", () => {
  it("minúsculas y sin tildes ni eñes especiales", () => {
    assert.equal(normalizeText("CAMIÓN Canción ÑANDÚ"), "camion cancion nandu");
  });
  it("palabras separadas por cualquier espacio; vacío = sin términos", () => {
    assert.deepEqual(titleTerms("  Gato   ROJO\t"), ["gato", "rojo"]);
    assert.deepEqual(titleTerms("   "), []);
    assert.deepEqual(titleTerms(""), []);
  });
});

describe("filterByTitle", () => {
  it("sin búsqueda devuelve la MISMA lista (misma referencia)", () => {
    assert.equal(filterByTitle(list, ""), list);
    assert.equal(filterByTitle(list, "   "), list);
  });
  it("ignora mayúsculas y tildes", () => {
    assert.deepEqual(ids(filterByTitle(list, "camion")), ["b"]);
    assert.deepEqual(ids(filterByTitle(list, "CANCIÓN")), ["e"]);
    assert.deepEqual(ids(filterByTitle(list, "gato")), ["a", "c"]);
  });
  it("varias palabras: todas, en cualquier orden", () => {
    assert.deepEqual(ids(filterByTitle(list, "rojo gato")), ["a"]);
    assert.deepEqual(ids(filterByTitle(list, "gato bomberos")), []);
  });
  it("busca subcadenas y signos", () => {
    assert.deepEqual(ids(filterByTitle(list, "mion")), ["b"]);
    assert.deepEqual(ids(filterByTitle(list, "¿que")), ["e"]);
  });
  it("items sin título nunca coinciden con una búsqueda", () => {
    assert.ok(!matchesTitle(list[3]!, ["a"]));
    assert.ok(matchesTitle(list[3]!, []));
  });
  it("conserva el orden y, al crecer la lista por el final, el resultado también crece por el final", () => {
    const before = filterByTitle(list.slice(0, 3), "gato");
    const after = filterByTitle([...list, entry("f", "otro gato")], "gato");
    assert.deepEqual(ids(after).slice(0, before.length), ids(before));
    assert.deepEqual(ids(after), ["a", "c", "f"]);
  });
});

describe("title en toEntry", () => {
  const item = (over: Partial<ChannelItem>): ChannelItem => ({
    id: "x", url: "u", thumbnails: [], cover: null, frames: [], animated: [], params: {}, ...over,
  });
  it("recorta; ausente o no-string (backend viejo) -> \"\"", () => {
    assert.equal(toEntry(item({ title: "  Hola  " }), "videos").title, "Hola");
    assert.equal(toEntry(item({}), "videos").title, "");
    assert.equal(toEntry(item({ title: 5 as unknown as string }), "videos").title, "");
  });
});

describe("?q= en la URL", () => {
  it("toSearch añade q solo si hay texto; el round-trip lo conserva", () => {
    const q = { ...DEFAULT_QUERY, channel: "@a" };
    assert.equal(toSearch(q), "?channel=@a");
    assert.equal(toSearch(q, "  "), "?channel=@a");
    assert.equal(toSearch(q, "gato rojo"), "?channel=@a&q=gato+rojo");
    assert.equal(parseTitleFilter(toSearch(q, "camión ñ & más")), "camión ñ & más");
  });
  it("q no afecta a la consulta de la API", () => {
    assert.deepEqual(parseListQuery("?channel=@a&q=hola"), { ...DEFAULT_QUERY, channel: "@a" });
    assert.equal(parseTitleFilter(""), "");
    assert.equal(toSearch(DEFAULT_QUERY, "solo q"), "?q=solo+q");
  });
  it("recorta a 120 caracteres", () => {
    assert.equal(parseTitleFilter(`?q=${"x".repeat(500)}`).length, 120);
  });
});
