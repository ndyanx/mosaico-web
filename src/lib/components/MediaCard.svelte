<script lang="ts">
  import type { ChannelEntry } from "../types.ts";
  import { createHoverPreview, type PreviewState } from "../hoverPreview.ts";
  import { isPlainClick } from "../embed.ts";

  interface Props {
    entry: ChannelEntry;
    /** Si está definido, el clic normal abre el reproductor embebido en vez de ir a YouTube.
     *  Ctrl/Cmd/Shift/botón medio siguen abriendo YouTube en otra pestaña. */
    onOpen?: (entry: ChannelEntry) => void;
  }
  let { entry, onOpen }: Props = $props();

  let img = $state<HTMLImageElement | null>(null);
  let loaded = $state(false);
  let failed = $state(false);

  const action = $derived(
    entry.section === "shorts"
      ? "Abrir short en YouTube"
      : entry.section === "streams"
        ? "Abrir directo en YouTube"
        : "Abrir video en YouTube",
  );
  // Con título: el lector de pantalla dice cuál es, y el cursor lo muestra como tooltip.
  const label = $derived(entry.title ? `${entry.title}. ${action}` : action);

  // Preview al pasar el cursor: webp animado (videos/streams) o frames alternados (shorts).
  // Solo se muestra si el recurso cargó y pasó la validación; si falla, queda la miniatura.
  let preview = $state<PreviewState>(null);
  let loadingPreview = $state(false);
  const reducedMotion =
    typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const hover = createHoverPreview(() => entry, (s) => (preview = s), {
    reducedMotion,
    onLoading: (v) => (loadingPreview = v),
    onFail: (kind, e, reason) => {
      if (import.meta.env.DEV) console.debug(`[preview] ${kind} falló para ${e.id}: ${reason}`, e.animatedUrl ?? e.frames);
    },
  });
  // La card se desmonta al salir del viewport (virtualización): corta descargas y timers.
  $effect(() => () => hover.stop());

  function onClick(e: MouseEvent) {
    if (!onOpen || !isPlainClick(e)) return;
    e.preventDefault();
    hover.stop();
    onOpen(entry);
  }

  function onEnter(e: PointerEvent) {
    if (e.pointerType !== "touch") hover.start(); // el touch no tiene hover
  }
  function onFocus(e: FocusEvent) {
    if ((e.currentTarget as HTMLElement).matches(":focus-visible")) hover.start();
  }

  // Una imagen en caché puede terminar de cargar antes de que se adjunte onload.
  $effect(() => {
    if (img && img.complete && img.naturalWidth > 0) loaded = true;
  });
</script>

<a
  class="card"
  href={entry.url}
  target="_blank"
  rel="noopener noreferrer"
  aria-label={label}
  title={entry.title || undefined}
  onclick={onClick}
  onpointerenter={onEnter}
  onpointerleave={() => hover.stop()}
  onpointercancel={() => hover.stop()}
  onfocus={onFocus}
  onblur={() => hover.stop()}
>
  {#if entry.coverUrl && !failed}
    <img
      bind:this={img}
      class="cover"
      class:loaded
      src={entry.coverUrl}
      alt=""
      decoding="async"
      draggable="false"
      referrerpolicy="no-referrer"
      onload={() => (loaded = true)}
      onerror={() => (failed = true)}
    />
    {#if preview}
      <img
        class="preview"
        class:frame={preview.kind === "frame"}
        src={preview.url}
        alt=""
        decoding="async"
        draggable="false"
        referrerpolicy="no-referrer"
      />
    {/if}
  {:else}
    <span class="placeholder" aria-hidden="true">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
    </span>
  {/if}
  {#if loadingPreview}<span class="loadbar" aria-hidden="true"></span>{/if}
</a>

<style>
  .card {
    position: relative;
    display: block;
    width: 100%;
    height: 100%;
    background: var(--surface-2);
    color: inherit;
    text-decoration: none;
    overflow: hidden;
    border-radius: inherit;
  }
  /* Borde interior sutil + realce al hover/foco (no ocupa espacio ni mueve el layout) */
  .card::after {
    content: "";
    position: absolute;
    inset: 0;
    border-radius: inherit;
    box-shadow: inset 0 0 0 1px var(--ring);
    pointer-events: none;
    transition: box-shadow 0.18s ease;
  }
  .card:hover::after {
    box-shadow: inset 0 0 0 2px var(--accent);
  }
  .card:focus-visible {
    outline: none;
  }
  .card:focus-visible::after {
    box-shadow: inset 0 0 0 3px var(--accent);
  }
  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    user-select: none;
    transition: transform 0.4s ease;
  }
  .cover {
    opacity: 0;
    transition:
      opacity 0.25s ease,
      transform 0.4s ease;
  }
  .cover.loaded {
    opacity: 1;
  }
  .card:hover img {
    transform: scale(1.035);
  }
  /* Encima de la miniatura (que sigue debajo: sin parpadeo). Al quitarlo del DOM, el webp se detiene. */
  .preview {
    position: absolute;
    inset: 0;
    animation: fade-in 0.18s ease;
  }
  .preview.frame {
    animation: none; /* los frames cambian en seco, como un slideshow */
  }
  .placeholder {
    display: grid;
    place-items: center;
    width: 100%;
    height: 100%;
    color: var(--text-3);
  }
  /* Indicador discreto mientras baja el preview (aparece tras 150 ms: no parpadea si es rápido) */
  .loadbar {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 3px;
    overflow: hidden;
    opacity: 0;
    animation: fade-in-full 0.2s ease 0.15s forwards;
    pointer-events: none;
  }
  .loadbar::before {
    content: "";
    position: absolute;
    inset: 0;
    width: 40%;
    background: var(--accent);
    border-radius: 3px;
    animation: slide 1s ease-in-out infinite;
  }
  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }
  @keyframes fade-in-full {
    to {
      opacity: 1;
    }
  }
  @keyframes slide {
    from {
      translate: -100% 0;
    }
    to {
      translate: 250% 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    img,
    .cover {
      transition: none;
    }
    .card:hover img {
      transform: none;
    }
    .preview {
      animation: none;
    }
    .loadbar::before {
      animation: none;
      width: 100%;
    }
  }
</style>
