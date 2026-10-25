// Backend de pruebas: el Fastify REAL de channel-feed-api, pero con un YouTube falso
// (el mismo de los tests del backend). Sirve para probar el frontend sin red.
//
// Uso: copia este archivo a channel-feed-api/test/ y, desde channel-feed-api:
//   pnpm tsx test/dev-fake.ts            (puerto 3100; PORT=3000 para sustituir al real)
//
// Canales: cualquier @handle sirve con datos inventados.
//   @vacio -> sin items | @noexiste -> 404 | @lento -> responde con 2 s de retraso
//   shorts: 41 items | videos: 120 | streams: 8
import { buildApp } from "../src/app.js";
import { ListingCache } from "../src/cache.js";
import { ChannelListing } from "../src/extractor.js";
import { ChannelService } from "../src/service.js";
import { FakeYouTube, vids } from "./fakeYoutube.js";

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

const app = buildApp({
  service: new ChannelService(cache, { prefetchAhead: 0 }),
  logger: { level: "warn" },
});
const port = Number(process.env.PORT ?? 3100);
await app.listen({ host: "127.0.0.1", port });
console.log(`dev-fake escuchando en http://127.0.0.1:${port}`);
