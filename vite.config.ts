import { defineConfig, loadEnv, type Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

/**
 * Metaetiquetas que necesitan URL ABSOLUTA (canonical, og:url, og:image): Facebook, X, WhatsApp, etc.
 * no resuelven rutas relativas. Con VITE_SITE_URL definida se escriben; sin ella se omiten
 * (el sitio funciona igual, solo se pierde la imagen al compartir el enlace).
 */
function siteMeta(siteUrl: string): Plugin {
  const base = siteUrl.trim().replace(/\/+$/, "");
  return {
    name: "site-meta",
    transformIndexHtml(html) {
      const canonical = base ? `<link rel="canonical" href="${base}/" />` : "";
      const og = base
        ? [
            `<meta property="og:url" content="${base}/" />`,
            `<meta property="og:image" content="${base}/og-image.png" />`,
            `<meta property="og:image:width" content="1200" />`,
            `<meta property="og:image:height" content="630" />`,
            `<meta name="twitter:image" content="${base}/og-image.png" />`,
          ].join("\n    ")
        : "";
      return html.replace("%SITE_URL_CANONICAL%", canonical).replace("%SITE_URL_OG%", og);
    },
  };
}

// Desarrollo: el frontend llama a /api/v1/channel y el proxy quita el prefijo /api y
// reenvia al backend local (channel-feed-api, `pnpm dev`, 127.0.0.1:3000).
// Otro destino: BACKEND_URL=http://127.0.0.1:4000 pnpm dev
// Produccion (Cloudflare Pages): no hay proxy; se usa VITE_API_URL (ver README).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");
  const proxy = {
    "/api": {
      target: env.BACKEND_URL || "http://127.0.0.1:3000",
      changeOrigin: true,
      rewrite: (path: string) => path.replace(/^\/api/, ""),
    },
  };
  return {
    plugins: [svelte(), siteMeta(env.VITE_SITE_URL ?? "")],
    server: { proxy },
    preview: { proxy },
  };
});
