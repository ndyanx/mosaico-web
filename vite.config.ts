import adapter from "@sveltejs/adapter-static";
import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig, lazyPlugins, loadEnv } from "vite-plus";

// Desarrollo: el frontend llama a /api/v1/channel y el proxy quita el prefijo /api y
// reenvia al backend local (channel-feed-api, `pnpm dev`, 127.0.0.1:3000).
// Otro destino: BACKEND_URL=http://127.0.0.1:4000 pnpm dev
// Produccion (Cloudflare Pages): no hay proxy; se usa VITE_API_URL (ver .env.example).
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
    fmt: {},
    lint: {
      jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
      rules: { "vite-plus/prefer-vite-plus-imports": "error" },
      options: { typeAware: true, typeCheck: true },
    },
    plugins: lazyPlugins(() => [
      sveltekit({
        compilerOptions: {
          // Force runes mode for the project, except for libraries. Can be removed in svelte 6.
          runes: ({ filename }) => (filename.split(/[/\\]/).includes("node_modules") ? undefined : true),
        },
        // SPA estatica (Cloudflare Pages): todas las rutas caen en index.html.
        adapter: adapter({ fallback: "index.html" }),
      }),
    ]),
    server: { proxy },
    preview: { proxy },
  };
});
