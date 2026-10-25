<script lang="ts">
  import { untrack } from "svelte";
  import MasonryGrid from "./components/MasonryGrid.svelte";
  import PlayerModal from "./components/PlayerModal.svelte";
  import { canEmbed } from "./lib/embed.ts";
  import ControlBar from "./components/ControlBar.svelte";
  import { createChannelList, type ListState } from "./lib/channelList.ts";
  import { normalizeQuery, parseListQuery, sameQuery, toSearch } from "./lib/urlState.ts";
  import { columnsFor } from "./lib/layout.ts";
  import { titleFor } from "./lib/site.ts";
  import { applyTheme, clampCols, loadPrefs, nextTheme, savePrefs, type Theme } from "./lib/prefs.ts";
  import type { ChannelEntry, ListQuery } from "./types.ts";

  // La consulta vive en la URL (?channel=@handle&section=shorts&sort_by=&members=) y la edita la ControlBar.
  let query = $state<ListQuery>(parseListQuery(location.search));

  // Preferencias de vista (no van en la URL): tema y máximo de columnas.
  const initial = loadPrefs();
  let theme = $state<Theme>(initial.theme);
  let maxCols = $state(initial.maxCols);
  let embed = $state(initial.embed);
  $effect(() => {
    applyTheme(theme);
    savePrefs({ theme, maxCols, embed });
  });

  // Título de la pestaña: refleja el canal que se está viendo.
  $effect(() => {
    document.title = titleFor(query.channel);
  });

  // Reproductor embebido. Con members=only los videos no se pueden embeber: se abre YouTube.
  let playing = $state.raw<ChannelEntry | null>(null);
  const embedOn = $derived(embed && query.members !== "only");
  function openPlayer(e: ChannelEntry): void {
    if (canEmbed(e, query)) playing = e;
    else window.open(e.url, "_blank", "noopener,noreferrer"); // id no válido: red de seguridad
  }

  // Un cambio de controles crea una entrada de historial (atrás/adelante lo deshacen);
  // si la consulta normalizada no cambia, no se hace nada (no reinicia la lista).
  function applyQuery(next: ListQuery): void {
    const q = normalizeQuery(next);
    if (sameQuery(q, query)) return;
    query = q;
    playing = null;
    history.pushState(null, "", `${location.pathname}${toSearch(q)}${location.hash}`);
  }

  function onPopState(): void {
    const q = parseListQuery(location.search);
    if (!sameQuery(q, query)) {
      query = q;
      playing = null;
    }
  }

  let list = $state.raw<ListState>({
    generation: 0,
    phase: "idle",
    entries: [],
    loadingMore: false,
    hasMore: false,
    total: null,
    cache: null,
    error: null,
    moreError: null,
    stale: false,
  });

  const loader = createChannelList({ onChange: (s) => (list = s) });

  // Cualquier cambio de la consulta reinicia la lista (cancela lo que haya en vuelo).
  $effect(() => {
    const q = $state.snapshot(query);
    untrack(() => loader.reset(q));
  });
  $effect(() => () => loader.dispose());

  const empty = $derived(list.phase === "ready" && list.entries.length === 0 && !list.hasMore);
  const counter = $derived(
    list.total !== null ? `${list.entries.length} de ${list.total}` : `${list.entries.length}`,
  );

  // El skeleton usa las mismas columnas que tendrá el grid (mismo padding horizontal: 40px).
  let winWidth = $state(typeof innerWidth === "number" ? innerWidth : 1280);
  const skCols = $derived(columnsFor(winWidth - 40, maxCols));

  // Alturas del skeleton (px, para videos; los shorts son más altos).
  const SK = [170, 230, 150, 210, 250, 160, 220, 190, 240, 150, 200, 180];
</script>

<svelte:window onpopstate={onPopState} bind:innerWidth={winWidth} />

<div class="app">
  <ControlBar
    {query}
    onChange={applyQuery}
    summary={list.phase === "ready" ? counter : ""}
    {maxCols}
    onMaxCols={(n) => (maxCols = clampCols(n))}
    {theme}
    onTheme={() => (theme = nextTheme(theme))}
    {embed}
    onEmbed={(v) => (embed = v)}
  />

  {#if list.stale}
    <div class="banner" role="status">
      <span>La lista cambió en YouTube mientras navegabas.</span>
      <button type="button" class="btn" onclick={() => loader.reload()}>Recargar</button>
    </div>
  {/if}

  <main class="stage">
    <MasonryGrid entries={list.entries} generation={list.generation} maxColumns={maxCols} onNearEnd={() => loader.loadMore()} onOpen={embedOn ? openPlayer : undefined}>
      {#snippet footer()}
        {#if list.phase === "ready"}
          <div class="footer" aria-live="polite">
            {#if list.moreError}
              <span class="err">No se pudo cargar más: {list.moreError.message}</span>
              <button type="button" class="btn" onclick={() => loader.retry()}>Reintentar</button>
            {:else if list.loadingMore}
              <span class="chip"><span class="spinner" aria-hidden="true"></span> Cargando más…</span>
            {:else if !list.hasMore && list.entries.length > 0}
              <span class="chip end">Fin · {list.entries.length} items</span>
            {/if}
          </div>
        {/if}
      {/snippet}
    </MasonryGrid>

    {#if list.phase === "idle"}
      <div class="state">
        <div class="badge" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m10 9.5 5 2.5-5 2.5z" fill="currentColor" /></svg>
        </div>
        <h2>Explora un canal</h2>
        <p>Escribe un <code>@handle</code>, un id <code>UC…</code> o la URL del canal y pulsa Enter.</p>
      </div>
    {:else if list.phase === "loading"}
      <div class="skeleton-wrap" role="status" aria-label="Cargando canal">
        <div class="skeleton" aria-hidden="true" style="--cols:{skCols}">
          {#each SK as h, i (i)}
            <div class="sk" style="--h:{query.section === 'shorts' ? Math.round(h * 1.7) : h}px; --d:{i * 70}ms"></div>
          {/each}
        </div>
        <div class="loading-note">
          <span class="chip"><span class="spinner" aria-hidden="true"></span> Cargando canal…</span>
          <span class="slow">La primera petición de un canal grande puede tardar unos segundos.</span>
        </div>
      </div>
    {:else if list.phase === "error" && list.error}
      <div class="state" role="alert">
        <div class="badge danger" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5M12 16v.01" /></svg>
        </div>
        <h2>No se pudo cargar</h2>
        <p class="err">{list.error.message}</p>
        {#if list.error.issues.length}
          <ul>
            {#each list.error.issues as issue (issue.param + issue.message)}
              <li><code>{issue.param}</code>: {issue.message}</li>
            {/each}
          </ul>
        {/if}
        <button type="button" class="btn primary" onclick={() => loader.retry()}>Reintentar</button>
      </div>
    {:else if empty}
      <div class="state">
        <div class="badge" aria-hidden="true">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M8 5l8 14" /></svg>
        </div>
        <h2>Sin resultados</h2>
        <p>Este canal no tiene contenido en esta sección.</p>
      </div>
    {/if}
  </main>
</div>

{#if playing}
  <PlayerModal entry={playing} onClose={() => (playing = null)} />
{/if}

<style>
  .app {
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  .banner {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 8px 16px;
    background: var(--warn-bg);
    border-bottom: 1px solid var(--warn-border);
    color: var(--warn-text);
  }
  .banner .btn {
    height: 28px;
    padding: 0 12px;
  }
  .stage {
    flex: 1;
    min-height: 0;
    position: relative;
  }

  /* Estados centrados */
  .state {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 24px;
    text-align: center;
    color: var(--text-2);
    pointer-events: none;
    overflow: hidden;
  }
  .state .btn {
    pointer-events: auto;
    margin-top: 6px;
  }
  .state h2 {
    margin: 4px 0 0;
    color: var(--text);
    font-size: 18px;
    font-weight: 600;
  }
  .state p,
  .state ul {
    margin: 0;
    max-width: 420px;
  }
  .state ul {
    padding: 0;
    list-style: none;
    font-size: 12px;
  }
  .badge {
    display: grid;
    place-items: center;
    width: 56px;
    height: 56px;
    border-radius: 18px;
    background: var(--surface);
    color: var(--text-2);
    box-shadow: var(--shadow);
  }
  .badge.danger {
    color: var(--danger);
  }
  .err {
    color: var(--danger);
  }
  code {
    padding: 1px 6px;
    border-radius: 6px;
    background: var(--surface-2);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 12px;
  }

  /* Skeleton tipo masonry */
  .skeleton-wrap {
    position: absolute;
    inset: 0;
    padding: 16px 20px;
    overflow: hidden;
    pointer-events: none;
  }
  .skeleton {
    column-count: var(--cols, 4);
    column-gap: 14px;
  }
  .sk {
    height: var(--h);
    margin-bottom: 14px;
    break-inside: avoid;
    border-radius: var(--radius-md);
    background: linear-gradient(100deg, var(--surface-2) 30%, var(--surface-3) 50%, var(--surface-2) 70%);
    background-size: 300% 100%;
    animation: shimmer 1.4s ease-in-out infinite;
    animation-delay: var(--d);
  }
  .loading-note {
    position: absolute;
    left: 50%;
    bottom: 28px;
    translate: -50% 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
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
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-3);
    box-shadow: none;
    background: var(--surface-2);
  }
  .slow {
    padding: 4px 10px;
    border-radius: 8px;
    background: var(--surface);
    font-size: 12px;
    color: var(--text-3);
    opacity: 0;
    animation: appear 0.3s ease 4s forwards;
  }

  .footer {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    padding: 24px 0 8px;
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
  @keyframes appear {
    to {
      opacity: 1;
    }
  }
  @media (max-width: 640px) {
    .skeleton {
      column-gap: 12px;
    }
    .skeleton-wrap {
      padding: 12px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .spinner,
    .sk {
      animation: none;
    }
    .slow {
      animation: none;
      opacity: 1;
    }
  }
</style>
