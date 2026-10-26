// Pruebas de la búsqueda de canales (sin navegador): lógica, API, URL y recientes. node --test tests/
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { ApiError, buildSearchUrl, fetchChannelSearch } from "../src/lib/api.ts";
import {
  avatarHue,
  avatarUrl,
  channelValueOf,
  cleanQuery,
  createFinder,
  createSuggester,
  formatSubscribers,
  initials,
  looksLikeChannel,
  type FinderState,
  type SuggestState,
} from "../src/lib/channelSearch.ts";
import {
  MAX_RECENTS,
  addRecent,
  loadRecents,
  parseRecents,
  recentFromHit,
  recentFromValue,
  removeRecent,
  saveRecents,
} from "../src/lib/recentChannels.ts";
import { DEFAULT_QUERY, parseFind, parseListQuery, toSearch } from "../src/lib/urlState.ts";
import { titleFor } from "../src/lib/site.ts";
import type { ChannelHit, ChannelSearchPage } from "../src/types.ts";

const uc = (n: number) => `UC${String(n).padStart(22, "0")}`;
const hit = (n: number, over: Partial<ChannelHit> = {}): ChannelHit => ({
  id: uc(n),
  url: `https://www.youtube.com/@c${n}`,
  handle: `@c${n}`,
  title: `Canal ${n}`,
  description: "",
  subscribers_text: `${n}K subscribers`,
  subscribers: n * 1000,
  thumbnails: [
    { url: `https://yt3.ggpht.com/a${n}=s88`, width: 88, height: 88 },
    { url: `https://yt3.ggpht.com/a${n}=s176`, width: 176, height: 176 },
  ],
  ...over,
});
const page = (items: ChannelHit[], over: Partial<ChannelSearchPage> = {}): ChannelSearchPage => ({
  query: "x",
  offset: 0,
  count: items.length,
  total_estimate: 100,
  has_more: false,
  cache: "miss",
  updated_at: "2026-10-25T00:00:00.000Z",
  items,
  ...over,
});
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("looksLikeChannel", () => {
  it("reconoce @handle, id UC, channel/UC y URLs", () => {
    assert.equal(looksLikeChannel("@calming_cornerASMR"), "@calming_cornerASMR");
    assert.equal(looksLikeChannel("  @abc  "), "@abc");
    assert.equal(looksLikeChannel(uc(5)), uc(5));
    assert.equal(looksLikeChannel(`channel/${uc(5)}`), uc(5));
    assert.equal(looksLikeChannel("https://www.youtube.com/@abc/videos"), "@abc");
    assert.equal(looksLikeChannel(`https://youtube.com/channel/${uc(7)}?x=1`), uc(7));
  });
  it("el texto normal se busca: una palabra suelta o varias no son un canal", () => {
    for (const t of ["calming", "calming corner", "@ab", "@a b", "", "   ", "UCshort", "https://youtube.com/watch?v=abcdefghijk"]) {
      assert.equal(looksLikeChannel(t), null, t);
    }
  });
  it("channelValueOf prefiere el handle y cae al id", () => {
    assert.equal(channelValueOf(hit(1)), "@c1");
    assert.equal(channelValueOf(hit(1, { handle: null })), uc(1));
  });
  it("cleanQuery colapsa espacios", () => assert.equal(cleanQuery("  a   b \n c "), "a b c"));
});

describe("presentación de un canal", () => {
  it("formatSubscribers", () => {
    assert.match(formatSubscribers({ subscribers: 36300, subscribers_text: "" }), /^36,3 mil suscriptores$/);
    assert.equal(formatSubscribers({ subscribers: 1, subscribers_text: "1 subscriber" }), "1 suscriptor");
    assert.equal(formatSubscribers({ subscribers: 284, subscribers_text: "" }), "284 suscriptores");
    assert.equal(formatSubscribers({ subscribers: 0, subscribers_text: "" }), "0 suscriptores");
    assert.equal(formatSubscribers({ subscribers: null, subscribers_text: null }), "");
    assert.equal(formatSubscribers({ subscribers: null, subscribers_text: "raro" }), "raro");
  });
  it("avatarUrl: el más chico que cubra px x densidad (88 o 176), y el mayor si ninguno alcanza", () => {
    const h = hit(1);
    assert.equal(avatarUrl(h, 36, 1), "https://yt3.ggpht.com/a1=s88");
    assert.equal(avatarUrl(h, 36, 2), "https://yt3.ggpht.com/a1=s88");
    assert.equal(avatarUrl(h, 36, 3), "https://yt3.ggpht.com/a1=s176");
    assert.equal(avatarUrl(h, 72, 1), "https://yt3.ggpht.com/a1=s88");
    assert.equal(avatarUrl(h, 72, 2), "https://yt3.ggpht.com/a1=s176");
    assert.equal(avatarUrl(h, 400, 3), "https://yt3.ggpht.com/a1=s176");
    assert.equal(avatarUrl(hit(1, { thumbnails: [] }), 36, 1), null);
    assert.equal(avatarUrl(hit(1, { thumbnails: [{ url: "http://x/a", width: 88, height: 88 }] }), 36, 1), null);
  });
  it("initials y avatarHue", () => {
    assert.equal(initials("calming corner ASMR"), "CC");
    assert.equal(initials("Radit’s Calming Corner"), "RC");
    assert.equal(initials("ñandú"), "Ñ");
    assert.equal(initials("🙂🙂"), "");
    assert.equal(avatarHue(uc(1)), avatarHue(uc(1)));
    const h = avatarHue(uc(2));
    assert.ok(h >= 0 && h < 360);
  });
});

describe("API: buildSearchUrl / fetchChannelSearch", () => {
  let server: Server;
  let base = "";
  const seen: string[] = [];
  before(async () => {
    server = createServer((req, res) => {
      seen.push(req.url ?? "");
      const url = new URL(req.url ?? "", "http://x");
      res.setHeader("content-type", "application/json");
      const q = url.searchParams.get("q");
      if (q === "boom") {
        res.statusCode = 503;
        res.end(JSON.stringify({ error: { type: "OverloadedError", message: "cola llena", reason: "queue_full" } }));
      } else if (q === "raro") {
        res.end(JSON.stringify({ nope: true }));
      } else {
        res.end(JSON.stringify(page([hit(1)])));
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  after(() => server.close());

  it("buildSearchUrl codifica y recorta", () => {
    const u = new URL(buildSearchUrl("  calming corner ", { offset: 20, max: 6, baseUrl: "http://h" }));
    assert.equal(u.pathname, "/v1/search/channels");
    assert.equal(u.searchParams.get("q"), "calming corner");
    assert.equal(u.searchParams.get("offset"), "20");
    assert.equal(u.searchParams.get("max"), "6");
  });
  it("devuelve la página", async () => {
    const p = await fetchChannelSearch("calming", { baseUrl: base });
    assert.equal(p.items.length, 1);
    assert.match(seen.at(-1)!, /^\/v1\/search\/channels\?q=calming&max=20&offset=0$/);
  });
  it("texto corto: error local, sin red", async () => {
    const before = seen.length;
    await assert.rejects(fetchChannelSearch("a", { baseUrl: base }), (e: unknown) => e instanceof ApiError && e.status === 400);
    assert.equal(seen.length, before);
  });
  it("errores del backend y formato inesperado", async () => {
    await assert.rejects(fetchChannelSearch("boom", { baseUrl: base }), (e: unknown) => e instanceof ApiError && e.status === 503 && e.type === "OverloadedError");
    await assert.rejects(fetchChannelSearch("raro", { baseUrl: base }), (e: unknown) => e instanceof ApiError && e.type === "InvalidResponse");
  });
  it("sin servidor: NetworkError", async () => {
    await assert.rejects(fetchChannelSearch("calming", { baseUrl: "http://127.0.0.1:1" }), (e: unknown) => e instanceof ApiError && e.type === "NetworkError");
  });
});

describe("createFinder (resultados con scroll infinito)", () => {
  it("pagina, deduplica y se detiene al final", async () => {
    const states: FinderState[] = [];
    const calls: number[] = [];
    const pages = [
      page([hit(1), hit(2)], { has_more: true }),
      page([hit(2), hit(3)], { has_more: true }), // el 2 se repite
      page([hit(4)], { has_more: false }),
    ];
    const f = createFinder({
      onChange: (s) => states.push(s),
      pageSize: 2,
      fetchPage: async (_q, o) => {
        calls.push(o?.offset ?? 0);
        return pages[calls.length - 1]!;
      },
    });
    f.search("  calming   corner ");
    assert.equal(f.getState().phase, "loading");
    assert.equal(f.getState().query, "calming corner");
    await wait(5);
    assert.deepEqual(f.getState().items.map((i) => i.id), [uc(1), uc(2)]);
    assert.equal(f.getState().total, 100);
    f.loadMore();
    f.loadMore(); // repetida: ignorada
    await wait(5);
    assert.deepEqual(f.getState().items.map((i) => i.id), [uc(1), uc(2), uc(3)]);
    f.loadMore();
    await wait(5);
    assert.equal(f.getState().items.length, 4);
    assert.equal(f.getState().hasMore, false);
    assert.deepEqual(calls, [0, 2, 4]);
    f.loadMore();
    await wait(5);
    assert.equal(calls.length, 3);
  });

  it("una página solo de repetidos sigue pidiendo sola", async () => {
    const calls: number[] = [];
    const f = createFinder({
      onChange: () => {},
      fetchPage: async (_q, o) => {
        calls.push(o?.offset ?? 0);
        return calls.length === 1 ? page([hit(1)], { has_more: true }) : calls.length === 2 ? page([hit(1)], { has_more: true }) : page([hit(2)]);
      },
    });
    f.search("calming");
    await wait(5);
    f.loadMore();
    await wait(10);
    assert.deepEqual(f.getState().items.map((i) => i.id), [uc(1), uc(2)]);
    assert.equal(f.getState().loadingMore, false);
  });

  it("una búsqueda nueva descarta la respuesta de la anterior", async () => {
    const resolvers = new Map<string, (p: ChannelSearchPage) => void>();
    const f = createFinder({
      onChange: () => {},
      fetchPage: (q) => new Promise((r) => resolvers.set(q, r)),
    });
    f.search("uno");
    f.search("dos");
    resolvers.get("uno")!(page([hit(1)]));
    resolvers.get("dos")!(page([hit(2)]));
    await wait(5);
    assert.deepEqual(f.getState().items.map((i) => i.id), [uc(2)]);
    assert.equal(f.getState().query, "dos");
  });

  it("error en la primera página -> phase error y retry; en la siguiente -> moreError y retry", async () => {
    let n = 0;
    const f = createFinder({
      onChange: () => {},
      fetchPage: async () => {
        n++;
        if (n === 1) throw new ApiError(502, "UpstreamError", "falló");
        if (n === 2) return page([hit(1)], { has_more: true });
        if (n === 3) throw new ApiError(503, "OverloadedError", "cola");
        return page([hit(2)]);
      },
    });
    f.search("calming");
    await wait(5);
    assert.equal(f.getState().phase, "error");
    assert.equal(f.getState().error?.status, 502);
    f.retry();
    await wait(5);
    assert.equal(f.getState().phase, "ready");
    f.loadMore();
    await wait(5);
    assert.equal(f.getState().moreError?.status, 503);
    assert.equal(f.getState().items.length, 1);
    f.retry();
    await wait(5);
    assert.equal(f.getState().items.length, 2);
    assert.equal(f.getState().moreError, null);
  });

  it("texto corto -> idle sin pedir nada; repetir la misma búsqueda no repite la petición", async () => {
    let n = 0;
    const f = createFinder({ onChange: () => {}, fetchPage: async () => (n++, page([hit(1)])) });
    f.search("a");
    assert.equal(f.getState().phase, "idle");
    f.search("calming");
    await wait(5);
    f.search(" calming ");
    await wait(5);
    assert.equal(n, 1);
  });
});

describe("createSuggester (desplegable)", () => {
  it("espera la pausa: solo la última tecla pide, y las anteriores no", async () => {
    const calls: string[] = [];
    const states: SuggestState[] = [];
    const s = createSuggester({
      delayMs: 20,
      onChange: (x) => states.push(x),
      fetchPage: async (q, o) => {
        calls.push(`${q}|${o?.max}`);
        return page([hit(1)]);
      },
    });
    s.input("ca");
    s.input("cal");
    s.input("calm");
    assert.equal(s.getState().phase, "loading");
    await wait(10);
    assert.equal(calls.length, 0);
    await wait(40);
    assert.deepEqual(calls, ["calm|6"]);
    assert.equal(s.getState().phase, "ready");
    assert.equal(s.getState().items.length, 1);
  });

  it("no pide para texto corto ni para un @handle / URL / id (se abren directo)", async () => {
    let n = 0;
    const s = createSuggester({ delayMs: 1, onChange: () => {}, fetchPage: async () => (n++, page([])) });
    for (const t of ["", "a", "@calming_cornerASMR", uc(1), "https://youtube.com/@abc"]) {
      s.input(t);
      await wait(8);
      assert.equal(s.getState().phase, "idle", t);
    }
    assert.equal(n, 0);
  });

  it("recuerda búsquedas: volver a escribir lo mismo no repite la petición", async () => {
    let n = 0;
    const s = createSuggester({ delayMs: 1, onChange: () => {}, fetchPage: async () => (n++, page([hit(1)])) });
    s.input("calming");
    await wait(15);
    s.input("calmin");
    s.input("Calming");
    assert.equal(s.getState().phase, "ready");
    assert.equal(n, 1);
  });

  it("descarta la respuesta de un texto viejo", async () => {
    const resolvers = new Map<string, (p: ChannelSearchPage) => void>();
    const s = createSuggester({ delayMs: 1, onChange: () => {}, fetchPage: (q) => new Promise((r) => resolvers.set(q, r)) });
    s.input("uno");
    await wait(10);
    s.input("dos");
    await wait(10);
    resolvers.get("uno")?.(page([hit(1)]));
    resolvers.get("dos")!(page([hit(2)]));
    await wait(5);
    assert.deepEqual(s.getState().items.map((i) => i.id), [uc(2)]);
  });

  it("error y retry; reset cancela lo pendiente", async () => {
    let n = 0;
    const s = createSuggester({
      delayMs: 1,
      onChange: () => {},
      fetchPage: async () => {
        n++;
        if (n === 1) throw new ApiError(0, "NetworkError", "sin red");
        return page([hit(1)]);
      },
    });
    s.input("calming");
    await wait(15);
    assert.equal(s.getState().phase, "error");
    s.retry();
    await wait(5);
    assert.equal(s.getState().phase, "ready");
    s.input("otro texto");
    s.reset();
    await wait(15);
    assert.equal(s.getState().phase, "idle");
    assert.equal(n, 2);
  });
});

describe("URL: ?find=", () => {
  it("parseFind y toSearch (round-trip, conserva el canal y el filtro de título)", () => {
    assert.equal(parseFind("?find=calming%20%20corner"), "calming corner");
    assert.equal(parseFind(""), "");
    assert.equal(parseFind(`?find=${"x".repeat(300)}`).length, 100);
    const q = { ...DEFAULT_QUERY, channel: "@a" };
    assert.equal(toSearch(q, "", "calming corner"), "?channel=%40a&find=calming+corner");
    assert.equal(toSearch(q, "gato", "perro"), "?channel=%40a&q=gato&find=perro");
    assert.equal(toSearch(DEFAULT_QUERY, "", " x  y "), "?find=x+y");
    assert.equal(toSearch(q), "?channel=%40a");
    assert.equal(parseFind(toSearch(q, "", "calming corner")), "calming corner");
    assert.equal(parseListQuery(toSearch(q, "", "calming")).channel, "@a");
  });
  it("título de la pestaña", () => {
    assert.equal(titleFor("@a", "calming corner"), "Canales: calming corner · Mosaico");
    assert.equal(titleFor("@a"), "@a · Mosaico");
    assert.ok(titleFor("", "x".repeat(60)).length < 70);
  });
});

describe("canales recientes", () => {
  it("addRecent: al principio, sin repetir, con tope", () => {
    let l = addRecent([], recentFromHit(hit(1)));
    l = addRecent(l, recentFromHit(hit(2)));
    l = addRecent(l, recentFromHit(hit(1)));
    assert.deepEqual(l.map((r) => r.key), ["@c1", "@c2"]);
    for (let i = 3; i < 20; i++) l = addRecent(l, recentFromHit(hit(i)));
    assert.equal(l.length, MAX_RECENTS);
    assert.equal(l[0]!.key, "@c19");
  });
  it("abrir a mano un canal ya guardado conserva su avatar y nombre; el @handle ignora mayúsculas", () => {
    const l = addRecent([recentFromHit(hit(1))], recentFromValue("@C1"));
    assert.equal(l.length, 1);
    assert.equal(l[0]!.title, "Canal 1");
    assert.equal(l[0]!.avatar, "https://yt3.ggpht.com/a1=s88");
  });
  it("recentFromHit: sin handle usa el id; el avatar es el chico", () => {
    const r = recentFromHit(hit(3, { handle: null }));
    assert.equal(r.key, uc(3));
    assert.equal(r.avatar, "https://yt3.ggpht.com/a3=s88");
  });
  it("removeRecent", () => assert.deepEqual(removeRecent([recentFromValue("@a"), recentFromValue("@b")], "@A").map((r) => r.key), ["@b"]));
  it("parseRecents tolera basura y descarta avatares no https", () => {
    assert.deepEqual(parseRecents(null), []);
    assert.deepEqual(parseRecents("no json"), []);
    assert.deepEqual(parseRecents("{}"), []);
    const l = parseRecents(JSON.stringify([{ key: "@a", title: "A", avatar: "javascript:x" }, { key: "@a" }, { nada: 1 }, 5, { key: "@b", title: 7, avatar: "https://x/y" }]));
    assert.deepEqual(l, [{ key: "@a", title: "A", avatar: null }, { key: "@b", title: "@b", avatar: "https://x/y" }]);
  });
  it("loadRecents / saveRecents con storage que falla", () => {
    const store = new Map<string, string>();
    const ok = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    saveRecents([recentFromValue("@a")], ok);
    assert.deepEqual(loadRecents(ok).map((r) => r.key), ["@a"]);
    const broken = { getItem: () => { throw new Error("x"); }, setItem: () => { throw new Error("x"); } };
    assert.deepEqual(loadRecents(broken), []);
    assert.doesNotThrow(() => saveRecents([recentFromValue("@a")], broken));
    assert.deepEqual(loadRecents(null), []);
  });
});
