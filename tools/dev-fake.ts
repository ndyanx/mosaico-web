// Backend de pruebas: el Fastify REAL de channel-feed-api, pero con un YouTube falso
// (el mismo de los tests del backend). Sirve para probar el frontend sin red.
//
// Uso: copia este archivo a channel-feed-api/test/ y, desde channel-feed-api:
//   pnpm tsx test/dev-fake.ts            (puerto 3100; PORT=3000 para sustituir al real)
//
// Canales: cualquier @handle sirve con datos inventados.
//   @vacio -> sin items | @noexiste -> 404 | @lento -> responde con 2 s de retraso
//   shorts: 41 items | videos: 120 | streams: 8
//
// Busqueda de canales (GET /v1/search/channels?q=...): 47 canales falsos por busqueda, de 20 en 20.
//   q con "vacio" -> sin resultados | q con "lento" -> 2 s de retraso | q con "error" -> 502
import { buildApp } from "../src/app.js";
import { ListingCache } from "../src/cache.js";
import { ChannelListing } from "../src/extractor.js";
import { ChannelService } from "../src/service.js";
import { ChannelSearch, SearchCache, SearchService } from "../src/search.js";
import { FakeYouTube, vids } from "./fakeYoutube.js";
import { FakeSearchYouTube, type FakeChannel } from "./fakeSearch.js";

const COUNTS = { shorts: 41, videos: 120, streams: 8 } as const;

const cache = new ListingCache({
  factory: (k) => {
    const empty = k.channel.toLowerCase().includes("vacio");
    const yt = new FakeYouTube({
      ids: empty ? [] : vids(1, COUNTS[k.section]),
      pageSize: 30,
      section: k.section,
    });
    if (k.channel.toLowerCase().includes("noexiste")) yt.channelExists = false;
    if (k.channel.toLowerCase().includes("lento")) yt.delayMs = 2000;
    return new ChannelListing({ ...k, sessionFactory: yt.session });
  },
});

const fakeChannels = (query: string): FakeChannel[] =>
  query.includes("vacio")
    ? []
    : Array.from({ length: 47 }, (_, i) => ({
        n: i + 1,
        title: i === 0 ? query : `${query} ${i + 1}`,
        handle: i % 9 === 8 ? null : `@${query.replace(/\s+/g, "")}${i + 1}`,
        subs: i % 7 === 6 ? null : `${(i + 1) * 137}${i % 3 === 0 ? "K" : ""} subscribers`,
        description: i % 4 === 3 ? "" : `Canal de prueba ${i + 1} sobre ${query}. Descripcion de relleno para ver como se recorta.`,
        noThumb: i % 11 === 10,
      }));

const searchCache = new SearchCache({
  factory: (query) => {
    const yt = new FakeSearchYouTube({ channels: fakeChannels(query), pageSize: 20 });
    if (query.includes("lento")) yt.delayMs = 2000;
    if (query.includes("error")) yt.failAll = true;
    return new ChannelSearch({ query, sessionFactory: yt.session });
  },
});

const app = buildApp({
  service: new ChannelService(cache, { prefetchAhead: 0 }),
  search: new SearchService(searchCache),
  logger: { level: "warn" },
});
const port = Number(process.env.PORT ?? 3100);
await app.listen({ host: "127.0.0.1", port });
console.log(`dev-fake escuchando en http://127.0.0.1:${port}`);
