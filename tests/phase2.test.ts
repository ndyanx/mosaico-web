// Pruebas de fase 2 (sin navegador). Requiere Node >= 22.18 (ejecuta .ts directamente):
//   node --test tests/
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, it } from "vite-plus/test";
import { ApiError, buildPageUrl, fetchChannelPage, isAbortError } from "../src/lib/api.ts";
import { getItemHeight, toEntry } from "../src/lib/thumbs.ts";
import type { ChannelItem, ListQuery } from "../src/types.ts";

const item = (over: Partial<ChannelItem> = {}): ChannelItem => ({
  id: "abc",
  url: "https://www.youtube.com/shorts/abc",
  title: "Mi short",
  thumbnails: [],
  cover: { url: "https://i.ytimg.com/vi/abc/oar3.jpg", width: 405, height: 720 },
  frames: ["https://x/oar3.jpg", "https://x/oardefault.jpg", "https://x/oar1.jpg", "https://x/oar2.jpg"],
  animated: [],
  params: {},
  ...over,
});

describe("toEntry / getItemHeight", () => {
  it("short con cover: dimensiones, frames y alto = colWidth * h / w", () => {
    const e = toEntry(item(), "shorts");
    assert.equal(e.width, 405);
    assert.equal(e.height, 720);
    assert.equal(e.coverUrl, "https://i.ytimg.com/vi/abc/oar3.jpg");
    assert.equal(e.frames.length, 4);
    assert.equal(e.animatedUrl, null);
    assert.equal(getItemHeight(e, 200), Math.round((200 * 720) / 405));
  });

  it("cover null -> aspecto fijo por sección (16:9 videos/streams, 9:16 shorts)", () => {
    const base = { cover: null, frames: [] };
    assert.equal(getItemHeight(toEntry(item(base), "videos"), 320), 180);
    assert.equal(getItemHeight(toEntry(item(base), "streams"), 320), 180);
    assert.equal(getItemHeight(toEntry(item(base), "shorts"), 180), 320);
    assert.equal(toEntry(item(base), "videos").coverUrl, null);
  });

  it("cover con width/height null -> conserva la url pero usa el aspecto fijo", () => {
    const e = toEntry(item({ cover: { url: "u", width: null, height: null } }), "videos");
    assert.equal(e.coverUrl, "u");
    assert.equal(e.width, 0);
    assert.equal(e.height, 0);
    assert.equal(getItemHeight(e, 320), 180);
  });

  it("cover con solo una dimensión o con 0 -> aspecto fijo", () => {
    assert.equal(toEntry(item({ cover: { url: "u", width: 100, height: null } }), "videos").width, 0);
    assert.equal(toEntry(item({ cover: { url: "u", width: 0, height: 0 } }), "videos").height, 0);
  });

  it("cover con url vacía se trata como sin cover", () => {
    assert.equal(toEntry(item({ cover: { url: "", width: 1, height: 1 } }), "videos").coverUrl, null);
  });

  it("frames: < 2 (o duplicados que se reducen a 1) -> []", () => {
    assert.deepEqual(toEntry(item({ frames: [] }), "shorts").frames, []);
    assert.deepEqual(toEntry(item({ frames: ["a"] }), "shorts").frames, []);
    assert.deepEqual(toEntry(item({ frames: ["a", "a"] }), "shorts").frames, []);
    assert.deepEqual(toEntry(item({ frames: ["a", "b", "a"] }), "shorts").frames, ["a", "b"]);
  });

  it("animated: primera con url; vacío -> null", () => {
    const withAnim = toEntry(
      item({ frames: [], animated: [{ url: "https://x/a.webp", width: 320, height: 180 }] }),
      "videos",
    );
    assert.equal(withAnim.animatedUrl, "https://x/a.webp");
    assert.equal(toEntry(item({ animated: [] }), "videos").animatedUrl, null);
  });
});

const query: ListQuery = { channel: " @canal ", section: "shorts", sort_by: "newest", members: "all" };

describe("buildPageUrl", () => {
  it("incluye todos los parámetros, output=full y reverse=false", () => {
    const u = new URL(buildPageUrl(query, { offset: 60 }), "http://x");
    assert.equal(u.pathname, "/api/v1/channel");
    assert.deepEqual(Object.fromEntries(u.searchParams), {
      channel: "@canal",
      section: "shorts",
      sort_by: "newest",
      members: "all",
      max: "60",
      offset: "60",
      output: "full",
      reverse: "false",
    });
  });
});

describe("fetchChannelPage", () => {
  let server: Server;
  let base = "";
  const okPage = {
    channel: "@canal", section: "shorts", offset: 0, count: 1, total: null,
    has_more: true, cache: "miss", updated_at: "2026-10-24T00:00:00.000Z", items: [item()],
  };

  beforeAll(async () => {
    server = createServer((req, res) => {
      const u = new URL(req.url ?? "/", "http://x");
      const send = (status: number, body: string, type = "application/json") => {
        res.writeHead(status, { "content-type": type });
        res.end(body);
      };
      switch (u.searchParams.get("channel")) {
        case "ok": return send(200, JSON.stringify(okPage));
        case "bad": return send(400, JSON.stringify({ error: { type: "ValidationError", message: "invalid query parameters", issues: [{ param: "max", message: "demasiado grande" }] } }));
        case "nf": return send(404, JSON.stringify({ error: { type: "NotFoundError", message: "canal no encontrado" } }));
        case "yt": return send(502, JSON.stringify({ error: { type: "UpstreamError", message: "YouTube falló" } }));
        case "empty500": return send(500, "", "text/plain");
        case "html404": return send(404, "<html>nope</html>", "text/html");
        case "notjson": return send(200, "hola", "text/plain");
        case "shape": return send(200, JSON.stringify({ items: "no" }));
        case "slow": return void setTimeout(() => send(200, JSON.stringify(okPage)), 1500);
        default: return send(500, "");
      }
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  });
  afterAll(() => { server.closeAllConnections(); server.close(); });

  const q = (channel: string): ListQuery => ({ ...query, channel });

  it("200: devuelve la página tipada", async () => {
    const p = await fetchChannelPage(q("ok"), { baseUrl: base });
    assert.equal(p.items.length, 1);
    assert.equal(p.has_more, true);
    assert.equal(p.total, null);
  });

  it("400: ApiError con status, type, message e issues del backend", async () => {
    await assert.rejects(fetchChannelPage(q("bad"), { baseUrl: base }), (e: unknown) => {
      assert.ok(e instanceof ApiError);
      assert.equal(e.status, 400);
      assert.equal(e.type, "ValidationError");
      assert.equal(e.message, "invalid query parameters");
      assert.deepEqual(e.issues, [{ param: "max", message: "demasiado grande" }]);
      return true;
    });
  });

  it("404 y 502: usan error.message del backend", async () => {
    await assert.rejects(fetchChannelPage(q("nf"), { baseUrl: base }), (e: unknown) =>
      e instanceof ApiError && e.status === 404 && e.message === "canal no encontrado");
    await assert.rejects(fetchChannelPage(q("yt"), { baseUrl: base }), (e: unknown) =>
      e instanceof ApiError && e.status === 502 && e.message === "YouTube falló");
  });

  it("5xx sin cuerpo (proxy con backend caído) -> BadGateway legible", async () => {
    await assert.rejects(fetchChannelPage(q("empty500"), { baseUrl: base }), (e: unknown) =>
      e instanceof ApiError && e.status === 500 && e.type === "BadGateway" && /Reintenta/.test(e.message));
  });

  it("4xx con cuerpo no JSON -> HttpError", async () => {
    await assert.rejects(fetchChannelPage(q("html404"), { baseUrl: base }), (e: unknown) =>
      e instanceof ApiError && e.type === "HttpError" && e.status === 404);
  });

  it("200 que no es JSON / forma inesperada -> InvalidResponse", async () => {
    for (const ch of ["notjson", "shape"]) {
      await assert.rejects(fetchChannelPage(q(ch), { baseUrl: base }), (e: unknown) =>
        e instanceof ApiError && e.type === "InvalidResponse");
    }
  });

  it("abort: lanza AbortError (isAbortError) y no ApiError", async () => {
    const ac = new AbortController();
    const p = fetchChannelPage(q("slow"), { baseUrl: base, signal: ac.signal });
    setTimeout(() => ac.abort(), 50);
    await assert.rejects(p, (e: unknown) => isAbortError(e) && !(e instanceof ApiError));
  });

  it("signal ya abortada: AbortError sin tocar la red", async () => {
    const ac = new AbortController();
    ac.abort();
    await assert.rejects(fetchChannelPage(q("ok"), { baseUrl: base, signal: ac.signal }), isAbortError);
  });

  it("backend caído (conexión rechazada) -> NetworkError status 0", async () => {
    await assert.rejects(fetchChannelPage(q("ok"), { baseUrl: "http://127.0.0.1:1/api" }), (e: unknown) =>
      e instanceof ApiError && e.status === 0 && e.type === "NetworkError");
  });

  it("canal vacío: ValidationError local, sin petición", async () => {
    await assert.rejects(fetchChannelPage(q("   "), { baseUrl: "http://127.0.0.1:1/api" }), (e: unknown) =>
      e instanceof ApiError && e.status === 400 && e.issues[0]?.param === "channel");
  });
});
