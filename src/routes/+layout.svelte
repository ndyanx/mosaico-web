<script lang="ts">
  import "../app.css";
  import type { LayoutProps } from "./$types";

  let { children }: LayoutProps = $props();

  const TITLE = "Mosaico · Galería de canales de YouTube";
  const DESCRIPTION =
    "Explora los videos, shorts y directos de cualquier canal de YouTube en una galería rápida, con vista previa al pasar el cursor. Pega un @handle y listo.";
  // Metaetiquetas que necesitan URL ABSOLUTA (canonical, og:url, og:image). Sin VITE_SITE_URL se omiten.
  const base = ((import.meta.env.VITE_SITE_URL as string | undefined) ?? "").trim().replace(/\/+$/, "");
</script>

<svelte:head>
  <title>{TITLE}</title>
  <meta name="description" content={DESCRIPTION} />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Mosaico" />
  <meta property="og:locale" content="es_ES" />
  <meta property="og:title" content={TITLE} />
  <meta
    property="og:description"
    content="Videos, shorts y directos de cualquier canal de YouTube en una galería rápida. Pega un @handle y explora."
  />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={TITLE} />
  <meta name="twitter:description" content="Videos, shorts y directos de cualquier canal de YouTube en una galería rápida." />
  {#if base}
    <link rel="canonical" href="{base}/" />
    <meta property="og:url" content="{base}/" />
    <meta property="og:image" content="{base}/og-image.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:image" content="{base}/og-image.png" />
  {/if}
</svelte:head>

{@render children()}
