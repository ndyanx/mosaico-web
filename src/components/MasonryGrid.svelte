<script lang="ts">
  import { untrack, type Snippet } from "svelte";
  import { createVirtualMasonry } from "../lib/virtualMasonry.ts";
  import { getItemHeight } from "../lib/thumbs.ts";
  import { columnBreakpoints } from "../lib/layout.ts";
  import MediaCard from "./MediaCard.svelte";
  import type { ChannelEntry, LayoutItem, MasonryState } from "../types.ts";

  interface Props {
    /** Lista deduplicada; dentro de una misma `generation` solo crece por el final. */
    entries: ChannelEntry[];
    /** Cambia cuando la lista es otra (canal/sección/orden...): se reconstruye todo. */
    generation: number;
    /** Se llama cuando el usuario se acerca al final (o el contenido no llena la pantalla). */
    onNearEnd?: () => void;
    /** Abre el reproductor embebido (undefined = enlace directo a YouTube). */
    onOpen?: (entry: ChannelEntry) => void;
    /** Tope de columnas en pantallas anchas (2..6). En pantallas chicas manda el responsive. */
    maxColumns?: number;
    /** Contenido bajo el canvas (cargando más, error, fin...). */
    footer?: Snippet;
  }

  let { entries, generation, onNearEnd, onOpen, maxColumns = 4, footer }: Props = $props();

  // Padding horizontal del scroller (20 + 20): debe coincidir con paddingX del motor.
  const PADDING_X = 40;
  const GAP = 14;
  const NEAR_END_MIN_PX = 800;

  let scroller = $state<HTMLElement | null>(null);
  let containerHeight = $state(0);
  let visibleItems = $state.raw<LayoutItem<ChannelEntry>[]>([]);

  // Los breakpoints del motor son estáticos: al cambiar el tope de columnas se crea otro motor.
  const masonry = $derived(
    createVirtualMasonry<ChannelEntry>({
      getItemHeight,
      paddingX: PADDING_X,
      gap: GAP,
      breakpoints: columnBreakpoints(maxColumns),
    }),
  );

  // Posición de scroll (0..1) para conservarla al cambiar de motor (otro nº de columnas).
  let lastRatio = 0;

  function onMasonryUpdate(s: MasonryState<ChannelEntry>) {
    containerHeight = s.containerHeight;
    visibleItems = s.visibleItems;
    if (s.containerHeight > 0) lastRatio = s.scrollTop / s.containerHeight;
    // Pide más con ~1.5 pantallas de margen; también cubre "la primera página no llena la pantalla".
    const margin = Math.max(NEAR_END_MIN_PX, s.viewportHeight * 1.5);
    if (s.scrollTop + s.viewportHeight >= s.containerHeight - margin) onNearEnd?.();
  }

  let syncedGeneration = -1;
  let syncedLength = 0;
  let seenGeneration = -1;

  // Monta el motor con lista vacía; el efecto de abajo le pasa los items.
  $effect(() => {
    const el = scroller;
    const m = masonry;
    if (!el) return;
    syncedGeneration = -1; // fuerza setItems en el efecto siguiente
    m.mount(el, [], onMasonryUpdate);
    return () => m.destroy();
  });

  // Lista nueva -> setItems (rebuild); mismos datos con más items -> appendToLayout (solo los nuevos).
  $effect(() => {
    const el = scroller;
    const gen = generation;
    const list = entries;
    const m = masonry;
    if (!el) return;
    untrack(() => {
      if (gen !== syncedGeneration) {
        // Misma lista con otro motor (cambió el nº de columnas): se conserva la posición relativa.
        const sameList = gen === seenGeneration;
        const ratio = lastRatio;
        seenGeneration = gen;
        syncedGeneration = gen;
        syncedLength = list.length;
        if (!sameList) el.scrollTop = 0;
        m.setItems(list);
        if (sameList && ratio > 0) {
          requestAnimationFrame(() => {
            el.scrollTop = ratio * m.getContainerHeight();
          });
        }
      } else if (list.length > syncedLength) {
        const fresh = list.slice(syncedLength);
        syncedLength = list.length;
        m.appendToLayout(fresh);
      }
    });
  });
</script>

<div class="scroller" bind:this={scroller} onscroll={(e) => masonry.onScroll(e)}>
  <div class="canvas" style="height: {containerHeight}px">
    {#each visibleItems as { key, item, x, y, width, height } (key)}
      <div class="cell" style="left:{x}px;top:{y}px;width:{width}px;height:{height}px">
        <MediaCard entry={item} {onOpen} />
      </div>
    {/each}
  </div>
  {@render footer?.()}
</div>

<style>
  .scroller {
    height: 100%;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 16px 20px 24px; /* horizontal = PADDING_X / 2 por lado */
    scrollbar-gutter: stable;
    position: relative;
  }
  .canvas {
    position: relative;
    width: 100%;
  }
  .cell {
    position: absolute;
    overflow: hidden;
    border-radius: var(--radius-md);
    background: var(--surface-2);
    contain: layout paint;
  }
</style>
