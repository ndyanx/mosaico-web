// Pruebas de fase 3: lista paginada (channelList) y parseo de la URL.
//   node --test "tests/*.test.ts"
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError } from "../src/lib/api.ts";
import { createChannelList, type ListState } from "../src/lib/channelList.ts";
import { parseListQuery } from "../src/lib/urlState.ts";
import type { ChannelItem, ChannelPage, ListQuery } from "../src/types.ts";

const Q: ListQuery = { channel: "@canal", section: "shorts", sort_by: "newest", members: "all" };
const item = (id: string): ChannelItem => ({
  id, url: `https://y/${id}`, thumbnails: [], params: {}, animated: [], frames: [],
  cover: { url: `https://i/${id}.jpg`, width: 405, height: 720 },
});
const page = (ids: string[], o: Partial<ChannelPage> = {}): ChannelPage => ({
  channel: "@canal", section: "shorts", offset: 0, count: ids.length, total: null,
  has_more: true, cache: "hit", updated_at: "T1", items: ids.map(item), ...o,
});

type Call = { offset: number; max: number; signal?: AbortSignal; resolve: (p: ChannelPage) => void; reject: (e: unknown) => void };

/** Loader con fetchPage controlado a mano: cada llamada queda pendiente hasta resolverla. */
function harness(pageSize = 3) {
  const calls: Call[] = [];
  const states: ListState[] = [];
  const loader = createChannelList({
    pageSize,
    onChange: (s) => states.push(s),
    fetchPage: (_q, o) =>
      new Promise<ChannelPage>((resolve, reject) => {
        const c: Call = { offset: o?.offset ?? 0, max: o?.max ?? 0, signal: o?.signal, resolve, reject };
        calls.push(c);
        o?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
      }),
  });
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { loader, calls, states, last: () => states[states.length - 1], flush };
}
const ids = (s: ListState) => s.entries.map((e) => e.id);

describe("createChannelList", () => {
  it("canal vacío: idle y sin peticiones", () => {
    const h = harness();
    h.loader.reset({ ...Q, channel: "  " });
    assert.equal(h.last().phase, "idle");
    assert.equal(h.calls.length, 0);
  });

  it("pagina con offset acumulado y se detiene con has_more=false", async () => {
    const h = harness();
    h.loader.reset(Q);
    assert.equal(h.last().phase, "loading");
    assert.deepEqual([h.calls[0].offset, h.calls[0].max], [0, 3]);
    h.calls[0].resolve(page(["a", "b", "c"]));
    await h.flush();
    assert.equal(h.last().phase, "ready");
    assert.deepEqual(ids(h.last()), ["a", "b", "c"]);

    h.loader.loadMore();
    assert.equal(h.last().loadingMore, true);
    assert.equal(h.calls[1].offset, 3);
    h.calls[1].resolve(page(["d", "e"], { has_more: false, total: 5 }));
    await h.flush();
    assert.deepEqual(ids(h.last()), ["a", "b", "c", "d", "e"]);
    assert.equal(h.last().hasMore, false);
    assert.equal(h.last().total, 5);
    assert.equal(h.last().loadingMore, false);

    h.loader.loadMore(); // ya no hay más: no pide nada
    assert.equal(h.calls.length, 2);
  });

  it("solo una petición en vuelo: loadMore repetido no duplica", async () => {
    const h = harness();
    h.loader.reset(Q);
    h.calls[0].resolve(page(["a", "b", "c"]));
    await h.flush();
    h.loader.loadMore(); h.loader.loadMore(); h.loader.loadMore();
    assert.equal(h.calls.length, 2);
  });

  it("deduplica por id y el offset avanza por lo que entregó el servidor", async () => {
    const h = harness();
    h.loader.reset(Q);
    h.calls[0].resolve(page(["a", "b", "c"]));
    await h.flush();
    h.loader.loadMore();
    // entró un video nuevo arriba: "c" se repite al inicio de la página 2
    h.calls[1].resolve(page(["c", "d", "e"]));
    await h.flush();
    assert.deepEqual(ids(h.last()), ["a", "b", "c", "d", "e"]);
    h.loader.loadMore();
    assert.equal(h.calls[2].offset, 6);
  });

  it("los entries solo crecen al final y conservan la identidad de los anteriores", async () => {
    const h = harness();
    h.loader.reset(Q);
    h.calls[0].resolve(page(["a", "b", "c"]));
    await h.flush();
    const before = h.last().entries;
    h.loader.loadMore();
    h.calls[1].resolve(page(["d"]));
    await h.flush();
    const after = h.last().entries;
    assert.equal(after.length, 4);
    for (let i = 0; i < before.length; i++) assert.equal(after[i], before[i]);
  });

  it("página de solo repetidos con has_more: sigue pidiendo sin intervención", async () => {
    const h = harness();
    h.loader.reset(Q);
    h.calls[0].resolve(page(["a", "b", "c"]));
    await h.flush();
    h.loader.loadMore();
    h.calls[1].resolve(page(["a", "b", "c"]));
    await h.flush();
    assert.equal(h.calls.length, 3, "pidió la siguiente por su cuenta");
    assert.equal(h.calls[2].offset, 6);
    assert.equal(h.last().loadingMore, true);
    h.calls[2].resolve(page(["d"], { has_more: false }));
    await h.flush();
    assert.deepEqual(ids(h.last()), ["a", "b", "c", "d"]);
    assert.equal(h.last().loadingMore, false);
  });

  it("página vacía con has_more=true: se detiene (sin bucle infinito)", async () => {
    const h = harness();
    h.loader.reset(Q);
    h.calls[0].resolve(page([], { has_more: true }));
    await h.flush();
    assert.equal(h.last().phase, "ready");
    assert.equal(h.last().hasMore, false);
    assert.equal(h.calls.length, 1);
  });

  it("reset con una petición en vuelo: la aborta e ignora su respuesta tardía", async () => {
    const h = harness();
    h.loader.reset(Q);
    const old = h.calls[0];
    h.loader.reset({ ...Q, section: "videos" });
    assert.equal(old.signal?.aborted, true);
    assert.equal(h.calls.length, 2);
    old.resolve(page(["VIEJO1", "VIEJO2"])); // llega tarde
    h.calls[1].resolve(page(["n1", "n2"]));
    await h.flush();
    assert.deepEqual(ids(h.last()), ["n1", "n2"]);
    assert.ok(h.states.every((s) => !ids(s).includes("VIEJO1")));
  });

  it("reset incrementa generation y vacía la lista", async () => {
    const h = harness();
    h.loader.reset(Q);
    h.calls[0].resolve(page(["a"]));
    await h.flush();
    const g = h.last().generation;
    h.loader.reset(Q);
    assert.equal(h.last().generation, g + 1);
    assert.equal(h.last().entries.length, 0);
    assert.equal(h.last().phase, "loading");
    // un id visto antes de reset vuelve a aceptarse
    h.calls[1].resolve(page(["a"]));
    await h.flush();
    assert.deepEqual(ids(h.last()), ["a"]);
  });

  it("error en la primera página: phase=error con ApiError; retry() recarga", async () => {
    const h = harness();
    h.loader.reset(Q);
    h.calls[0].reject(new ApiError(404, "ChannelError", "canal no encontrado"));
    await h.flush();
    assert.equal(h.last().phase, "error");
    assert.equal(h.last().error?.message, "canal no encontrado");
    h.loader.loadMore(); // no hace nada en error
    assert.equal(h.calls.length, 1);
    h.loader.retry();
    assert.equal(h.last().phase, "loading");
    h.calls[1].resolve(page(["a"]));
    await h.flush();
    assert.equal(h.last().phase, "ready");
    assert.equal(h.last().error, null);
  });

  it("error en páginas siguientes: conserva la lista, no reintenta solo, retry() continúa", async () => {
    const h = harness();
    h.loader.reset(Q);
    h.calls[0].resolve(page(["a", "b", "c"]));
    await h.flush();
    h.loader.loadMore();
    h.calls[1].reject(new ApiError(502, "UpstreamError", "YouTube falló"));
    await h.flush();
    assert.equal(h.last().phase, "ready");
    assert.equal(h.last().entries.length, 3);
    assert.equal(h.last().moreError?.status, 502);
    assert.equal(h.last().loadingMore, false);

    h.loader.loadMore(); h.loader.loadMore(); // el scroll no debe reintentar en bucle
    assert.equal(h.calls.length, 2);

    h.loader.retry();
    assert.equal(h.calls.length, 3);
    assert.equal(h.calls[2].offset, 3);
    h.calls[2].resolve(page(["d"], { has_more: false }));
    await h.flush();
    assert.deepEqual(ids(h.last()), ["a", "b", "c", "d"]);
    assert.equal(h.last().moreError, null);
  });

  it("error no ApiError se envuelve como ApiError", async () => {
    const h = harness();
    h.loader.reset(Q);
    h.calls[0].reject(new TypeError("boom"));
    await h.flush();
    assert.ok(h.last().error instanceof ApiError);
    assert.equal(h.last().error?.message, "boom");
  });

  it("stale: updated_at distinto entre páginas; reload() lo limpia", async () => {
    const h = harness();
    h.loader.reset(Q);
    h.calls[0].resolve(page(["a", "b", "c"], { updated_at: "T1" }));
    await h.flush();
    assert.equal(h.last().stale, false);
    h.loader.loadMore();
    h.calls[1].resolve(page(["d"], { updated_at: "T2" }));
    await h.flush();
    assert.equal(h.last().stale, true);
    h.loader.reload();
    assert.equal(h.last().stale, false);
    assert.equal(h.calls[2].offset, 0);
  });

  it("dispose aborta lo pendiente y no emite más", async () => {
    const h = harness();
    h.loader.reset(Q);
    const n = h.states.length;
    h.loader.dispose();
    assert.equal(h.calls[0].signal?.aborted, true);
    h.calls[0].resolve(page(["a"]));
    await h.flush();
    assert.equal(h.states.length, n);
  });
});

describe("parseListQuery", () => {
  it("lee los cuatro parámetros", () => {
    assert.deepEqual(parseListQuery("?channel=%40ASMRKittyKlaw&section=shorts&sort_by=popular&members=public"), {
      channel: "@ASMRKittyKlaw", section: "shorts", sort_by: "popular", members: "public",
    });
  });
  it("valores inválidos o ausentes -> defaults; alias de section", () => {
    assert.deepEqual(parseListQuery(""), { channel: "", section: "videos", sort_by: "newest", members: "all" });
    assert.deepEqual(parseListQuery("?channel=%20@x%20&section=nope&sort_by=zzz&members=?"), {
      channel: "@x", section: "videos", sort_by: "newest", members: "all",
    });
    assert.equal(parseListQuery("?section=short").section, "shorts");
    assert.equal(parseListQuery("?section=live").section, "streams");
  });
});
