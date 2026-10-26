# Mosaico

Galería masonry virtual de los videos, shorts y directos de un canal de YouTube.
Svelte 5 + Vite + TypeScript. Consume [`channel-feed-api`](../channel-feed-api).

## Desarrollo

```powershell
pnpm install
pnpm dev          # http://localhost:5173 (necesita el backend en 127.0.0.1:3000)
pnpm test
pnpm typecheck
pnpm build        # genera dist/
```

En desarrollo el frontend llama a `/api/...` y el proxy de Vite reenvía al backend local
(`BACKEND_URL=http://127.0.0.1:4000 pnpm dev` para otro destino). Sin backend real, usa
`tools/dev-fake.ts` (se copia a `channel-feed-api/test/`, donde ya están `fakeYoutube.ts` y
`fakeSearch.ts`; instrucciones dentro del archivo). Ahí cualquier texto devuelve 47 canales de prueba;
`vacio` = sin resultados, `lento` = 2 s de retraso, `error` = 502.

## Buscar canales

La primera caja de la barra sirve para dos cosas y decide sola cuál:

| Lo que escribes | Qué pasa |
|-----------------|----------|
| `@handle`, id `UC…`, `channel/UC…` o una URL de canal | Aparece «Abrir @handle»: Enter abre el mosaico directo, sin buscar. |
| Texto (2 o más caracteres): `calming corner` | Tras una pausa de 300 ms se piden 6 sugerencias (avatar, nombre, @handle y suscriptores). Enter busca; clic en una sugerencia abre ese canal. |
| Nada (caja vacía al enfocar) | Los canales recientes. `Supr` sobre uno resaltado, o su `×`, lo quita; «Borrar todo» vacía la lista. |

- **Página de resultados:** «Ver todos los resultados» (Enter sobre el texto) muestra tarjetas con avatar
  grande, nombre, @handle, suscriptores y descripción, con scroll infinito (20 por página, sin repetidos).
  Clic en una tarjeta abre el canal; «Volver al mosaico» regresa al canal que se estaba viendo.
- **URL:** la página de resultados vive en `?find=texto` y conserva `?channel=` y `?q=`: atrás/adelante y
  los enlaces compartidos funcionan. Cambiar sección, orden o miembros cierra los resultados.
- **Teclado:** `↑` `↓` mueven el resaltado, `Enter` elige, `Esc` cierra la lista (otra vez: revierte el texto).
- **Avatares:** vienen del backend (`thumbnails`, 88 y 176 px). Se usa el más chico que cubra el tamaño por la
  densidad de pantalla y, si la imagen falla o no existe, se muestran las iniciales con un color fijo por canal.
  Si un día pones una CSP, `img-src` debe permitir `https://yt3.ggpht.com`.
- **Recientes:** se guardan en `localStorage` (`ytgallery:recent-channels`, máximo 8), solo en este navegador.
- **Cambio de comportamiento:** el canal escrito a mano ya no se confirma al salir del campo; hay que pulsar
  Enter o elegir la fila «Abrir…».
- Lógica sin Svelte en `src/lib/channelSearch.ts` y `src/lib/recentChannels.ts`; pruebas en
  `tests/channelSearch.test.ts`. Necesita el endpoint `GET /v1/search/channels` del backend.

## Búsqueda por título

Junto a la caja de canales hay otro campo, «Buscar por título…», que filtra en el navegador (sin pedir nada
nuevo a la API) sobre los títulos que manda el backend en cada item (`title`).

- Sin mayúsculas ni tildes; con varias palabras deben aparecer **todas**, en cualquier orden.
- Mientras hay búsqueda, la app sigue pidiendo páginas hasta el final del canal, para que el
  resultado cubra todo el canal y no solo lo que ya se había cargado (puede tardar en canales grandes).
- Se guarda en la URL como `?q=` (compartible). Cambiar de canal la borra; cambiar sección, orden o
  miembros la conserva. `Esc` la limpia.
- Si el backend aún no manda `title`, la búsqueda no encuentra nada y la pantalla lo avisa.
- Lógica en `src/lib/titleSearch.ts`; pruebas en `tests/titleSearch.test.ts`.

## Desplegar en Cloudflare Pages

En producción **no hay proxy**: el navegador llama directo al backend de Render, así que se
necesitan dos cosas: `VITE_API_URL` aquí y `CORS_ORIGINS` en el backend.

1. Sube la carpeta a GitHub.
2. Cloudflare > **Workers & Pages** > **Create** > **Pages** > **Connect to Git** y elige el repo.
3. Configuración de build:

   | Campo                  | Valor        |
   |------------------------|--------------|
   | Framework preset       | None         |
   | Build command          | `pnpm build` |
   | Build output directory | `dist`       |

4. **Environment variables** (Production, y Preview si lo usas):

   | Variable         | Valor                                        | Para qué |
   |------------------|----------------------------------------------|----------|
   | `PNPM_VERSION`   | `12.15.0`                                    | Pages trae pnpm 10 por defecto; el lockfile se generó con 12 |
   | `NODE_VERSION`   | `22` (ya está en `.node-version`)            | Vite 8 exige Node >= 20.19 |
   | `VITE_API_URL`   | `https://TU-API.onrender.com` (sin `/` final) | Dónde está el backend |
   | `VITE_SITE_URL`  | `https://TU-SITIO.pages.dev` (opcional)      | `canonical` e imagen al compartir enlaces |

   `VITE_*` se incrustan **al compilar**: si las cambias, haz un nuevo deploy.
5. Copia la URL final de Pages y ponla en `CORS_ORIGINS` del backend (Render > Environment).

Si no la pones, el sitio carga pero la galería muestra «No se pudo conectar con el servidor» y en
la consola del navegador aparece un error de CORS.

## Nombre, título e identidad

- Nombre del sitio: `src/lib/site.ts` (`SITE_NAME`). El título de la pestaña se actualiza con el
  canal que estés viendo (`@canal · Mosaico`).
- `index.html` tiene el `<title>`, la descripción y las etiquetas Open Graph / Twitter: si cambias
  el nombre, cámbialo también ahí y en `public/site.webmanifest`.
- Íconos e imagen para compartir en `public/` (`favicon.svg`, `apple-touch-icon.png`, `icon-*.png`,
  `og-image.png` 1200x630). `public/_headers` define cabeceras de seguridad y caché de Pages.

## Aviso

Proyecto no afiliado a YouTube ni a Google. «YouTube» es marca de Google LLC.
