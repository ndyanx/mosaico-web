<script lang="ts">
  import ChannelAvatar from "./ChannelAvatar.svelte";
  import { avatarUrl, formatSubscribers, type FinderState } from "../channelSearch.ts";
  import type { ChannelHit } from "../types.ts";

  interface Props {
    /** Estado del buscador (ver `createFinder`). */
    search: FinderState;
    onOpen: (hit: ChannelHit) => void;
    onMore: () => void;
    onRetry: () => void;
    /** Volver al mosaico del canal que se estaba viendo (si había uno). */
    onClose?: () => void;
  }
  let { search, onOpen, onMore, onRetry, onClose }: Props = $props();

  const compact = new Intl.NumberFormat("es", { notation: "compact", maximumFractionDigits: 1 });
  const SK = [0, 1, 2, 3, 4, 5, 6, 7];

  let scroller = $state<HTMLElement | null>(null);
  let sentinel = $state<HTMLElement | null>(null);

  // Scroll infinito. Se vuelve a observar tras cada carga: si el centinela sigue a la vista
  // (pantalla alta, pocos resultados), el observador nuevo avisa de inmediato y pide más.
  $effect(() => {
    void search.items.length;
    if (!scroller || !sentinel || !search.hasMore || search.loadingMore || search.moreError) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && onMore(), {
      root: scroller,
      rootMargin: "400px",
    });
    io.observe(sentinel);
    return () => io.disconnect();
  });

  // Búsqueda nueva: arriba del todo.
  $effect(() => {
    void search.generation;
    scroller?.scrollTo({ top: 0 });
  });

  const total = $derived(search.total && search.total > search.items.length ? `≈ ${compact.format(search.total)} resultados en YouTube` : "");
</script>

<div class="results" bind:this={scroller}>
  <div class="wrap">
    <header>
      <div class="head">
        <h1>Canales para «{search.query}»</h1>
        <p class="sub">
          {#if search.phase === "ready"}
            {search.items.length} {search.items.length === 1 ? "canal" : "canales"}{total ? ` · ${total}` : ""}
          {:else if search.phase === "loading"}
            Buscando…
          {/if}
        </p>
      </div>
      {#if onClose}
        <button type="button" class="btn" onclick={onClose}>Volver al mosaico</button>
      {/if}
    </header>

    {#if search.phase === "loading"}
      <div class="grid" role="status" aria-label="Buscando canales">
        {#each SK as n (n)}
          <div class="card sk" aria-hidden="true" style="--d:{n * 70}ms">
            <span class="sk-av"></span><span class="sk-l"></span><span class="sk-l short"></span><span class="sk-l"></span>
          </div>
        {/each}
      </div>
    {:else if search.phase === "error" && search.error}
      <div class="state" role="alert">
        <h2>No se pudo buscar</h2>
        <p class="err">{search.error.message}</p>
        <button type="button" class="btn primary" onclick={onRetry}>Reintentar</button>
      </div>
    {:else if search.phase === "ready" && search.items.length === 0}
      <div class="state">
        <h2>Sin canales</h2>
        <p>YouTube no encontró canales para «{search.query}». Prueba con otras palabras, o pega el @handle del canal en la barra.</p>
      </div>
    {:else if search.phase === "ready"}
      <ul class="grid">
        {#each search.items as hit (hit.id)}
          <li>
            <button type="button" class="card" onclick={() => onOpen(hit)} aria-label="Abrir {hit.title}">
              <ChannelAvatar id={hit.id} title={hit.title} src={avatarUrl(hit, 72)} size={72} />
              <span class="nm">{hit.title}</span>
              {#if hit.handle}<span class="hd">{hit.handle}</span>{/if}
              {#if formatSubscribers(hit)}<span class="pill">{formatSubscribers(hit)}</span>{/if}
              <span class="ds">{hit.description}</span>
            </button>
          </li>
        {/each}
      </ul>

      <div class="footer" bind:this={sentinel}>
        {#if search.loadingMore}
          <span class="chip"><span class="spinner" aria-hidden="true"></span> Cargando más canales…</span>
        {:else if search.moreError}
          <span class="err">{search.moreError.message}</span>
          <button type="button" class="btn" onclick={onRetry}>Reintentar</button>
        {:else if !search.hasMore}
          <span class="chip end">Fin · {search.items.length} {search.items.length === 1 ? "canal" : "canales"}</span>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .results {
    position: absolute;
    inset: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }
  .wrap {
    max-width: 1240px;
    margin: 0 auto;
    padding: 20px;
  }
  header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 16px;
  }
  .head {
    min-width: 0;
  }
  h1 {
    margin: 0;
    font-size: 20px;
    font-weight: 700;
    letter-spacing: -0.01em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    margin: 2px 0 0;
    min-height: 1.4em;
    color: var(--text-3);
    font-size: 13px;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 14px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    width: 100%;
    height: 100%;
    padding: 18px 14px 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    color: var(--text);
    font: inherit;
    text-align: center;
    cursor: pointer;
    transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s;
  }
  button.card:hover {
    transform: translateY(-2px);
    border-color: var(--accent);
    box-shadow: var(--shadow-lift);
  }
  button.card:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .nm {
    max-width: 100%;
    margin-top: 8px;
    font-weight: 600;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }
  .hd {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-2);
    font-size: 12px;
  }
  .pill {
    margin-top: 4px;
    padding: 2px 10px;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent);
    font-size: 12px;
    font-weight: 500;
  }
  .ds {
    margin-top: 6px;
    color: var(--text-2);
    font-size: 12px;
    line-height: 1.45;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
    overflow-wrap: anywhere;
  }

  /* Cargando */
  .card.sk {
    height: 190px;
    pointer-events: none;
    gap: 10px;
  }
  .sk-av,
  .sk-l {
    background: linear-gradient(100deg, var(--surface-2) 30%, var(--surface-3) 50%, var(--surface-2) 70%);
    background-size: 300% 100%;
    animation: shimmer 1.4s ease-in-out infinite;
    animation-delay: var(--d);
  }
  .sk-av {
    width: 72px;
    height: 72px;
    border-radius: 50%;
  }
  .sk-l {
    width: 70%;
    height: 10px;
    border-radius: 5px;
  }
  .sk-l.short {
    width: 40%;
  }

  .state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 64px 24px;
    text-align: center;
    color: var(--text-2);
  }
  .state h2 {
    margin: 0;
    color: var(--text);
    font-size: 18px;
    font-weight: 600;
  }
  .state p {
    max-width: 420px;
    margin: 0;
  }
  .err {
    color: var(--danger);
  }

  .footer {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    min-height: 56px;
    padding: 24px 0 8px;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    padding: 0 14px;
    border-radius: 999px;
    background: var(--surface);
    color: var(--text-2);
    box-shadow: var(--shadow-lift);
    font-size: 13px;
  }
  .chip.end {
    background: var(--surface-2);
    box-shadow: none;
    color: var(--text-3);
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid var(--surface-3);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  @keyframes shimmer {
    from {
      background-position: 100% 0;
    }
    to {
      background-position: -100% 0;
    }
  }
  @media (max-width: 640px) {
    .wrap {
      padding: 12px;
    }
    .grid {
      grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
      gap: 10px;
    }
    header {
      flex-wrap: wrap;
      align-items: flex-start;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .spinner,
    .sk-av,
    .sk-l {
      animation: none;
    }
    button.card:hover {
      transform: none;
    }
  }
</style>
