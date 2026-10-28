<script lang="ts">
  import ChannelAvatar from "./ChannelAvatar.svelte";
  import { MIN_SEARCH_CHARS } from "../api.ts";
  import {
    avatarUrl,
    channelValueOf,
    cleanQuery,
    createSuggester,
    formatSubscribers,
    looksLikeChannel,
    type SuggestState,
  } from "../channelSearch.ts";
  import type { RecentChannel } from "../recentChannels.ts";
  import type { ChannelHit } from "../types.ts";

  interface Props {
    /** Canal que se está viendo ("" = ninguno). */
    channel: string;
    /** Búsqueda de canales abierta (`?find=`), "" si no hay. */
    find: string;
    recents: RecentChannel[];
    /** Abrir un canal en el mosaico. `from` trae su nombre y avatar si vino de un resultado. */
    onOpenChannel: (value: string, from?: ChannelHit) => void;
    /** Mostrar la página de resultados de este texto. */
    onShowResults: (q: string) => void;
    onRemoveRecent: (key: string) => void;
    onClearRecents: () => void;
  }
  let { channel, find, recents, onOpenChannel, onShowResults, onRemoveRecent, onClearRecents }: Props = $props();

  type Row =
    | { kind: "open"; value: string }
    | { kind: "results"; q: string }
    | { kind: "hit"; hit: ChannelHit }
    | { kind: "recent"; item: RecentChannel };

  const uid = $props.id();

  let draft = $state("");
  /** true desde que el usuario escribe hasta que cierra la caja; mientras no, la caja muestra el canal/búsqueda actual. */
  let editing = $state(false);
  let open = $state(false);
  /** Fila resaltada con las flechas (-1 = ninguna: manda la acción por defecto). */
  let active = $state(-1);
  let input = $state<HTMLInputElement | null>(null);

  let suggest = $state.raw<SuggestState>({ phase: "idle", query: "", items: [], error: null });
  const suggester = createSuggester({ onChange: (s) => (suggest = s) });
  $effect(() => () => suggester.dispose());

  // Sin editar, la caja refleja la URL (atrás/adelante incluidos).
  $effect(() => {
    if (!editing) draft = find || channel;
  });

  const text = $derived(cleanQuery(draft));
  const direct = $derived(editing ? looksLikeChannel(draft) : null);
  const canSearch = $derived(editing && !direct && text.length >= MIN_SEARCH_CHARS);
  const showRecents = $derived(!editing || !draft.trim());

  const rows = $derived.by<Row[]>(() => {
    if (showRecents) return recents.map((item) => ({ kind: "recent", item }));
    if (direct) return [{ kind: "open", value: direct }];
    if (canSearch) {
      const hits = suggest.items.map((hit): Row => ({ kind: "hit", hit }));
      return [{ kind: "results", q: text }, ...hits];
    }
    return [];
  });

  // La acción por defecto (Enter sin flechas) es la primera fila si es "abrir" o "buscar".
  const hasDefault = $derived(rows[0]?.kind === "open" || rows[0]?.kind === "results");
  const hi = $derived(active >= 0 && active < rows.length ? active : hasDefault ? 0 : -1);

  const matches = $derived(suggest.query.toLowerCase() === text.toLowerCase());
  const loading = $derived(canSearch && suggest.phase === "loading" && suggest.items.length === 0);
  const failedSuggest = $derived(canSearch && suggest.phase === "error" && matches);
  const noHits = $derived(canSearch && suggest.phase === "ready" && matches && suggest.items.length === 0);
  const refreshing = $derived(canSearch && suggest.phase === "loading" && suggest.items.length > 0);

  const visible = $derived(open && rows.length > 0);

  function close(): void {
    open = false;
    editing = false;
    active = -1;
    suggester.reset();
  }

  function onInput(): void {
    editing = true;
    open = true;
    active = -1;
    suggester.input(draft);
  }

  function onFocus(): void {
    open = true;
    if (!editing) input?.select();
  }

  function onBlur(): void {
    close();
  }

  function clear(): void {
    draft = "";
    editing = true;
    open = true;
    active = -1;
    suggester.reset();
    input?.focus();
  }

  function act(row: Row): void {
    const done = (fn: () => void) => {
      close();
      input?.blur();
      fn();
    };
    if (row.kind === "open") done(() => onOpenChannel(row.value));
    else if (row.kind === "results") done(() => onShowResults(row.q));
    else if (row.kind === "hit") done(() => onOpenChannel(channelValueOf(row.hit), row.hit));
    else done(() => onOpenChannel(row.item.key));
  }

  function submit(): void {
    const row = hi >= 0 ? rows[hi] : undefined;
    if (row) act(row);
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!open) {
        open = true;
      } else if (rows.length) {
        const step = e.key === "ArrowDown" ? 1 : -1;
        const from = hi < 0 && step === -1 ? 0 : hi;
        active = (from + step + rows.length) % rows.length;
      }
      e.preventDefault();
    } else if (e.key === "Escape") {
      if (open && rows.length) {
        open = false;
      } else {
        close();
        draft = find || channel;
        input?.blur();
      }
      e.preventDefault();
    } else if (e.key === "Delete" && showRecents && hi >= 0) {
      const row = rows[hi];
      if (row?.kind === "recent") {
        onRemoveRecent(row.item.key);
        active = Math.min(hi, rows.length - 2);
        e.preventDefault();
      }
    }
  }

  function meta(hit: ChannelHit): string {
    return [hit.handle, formatSubscribers(hit)].filter(Boolean).join(" · ");
  }
</script>

<div class="finder" role="search">
  <form
    onsubmit={(e) => {
      e.preventDefault();
      submit();
    }}
  >
    <svg class="ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
    <input
      bind:this={input}
      type="text"
      name="channel"
      role="combobox"
      aria-label="Buscar un canal o abrirlo"
      aria-autocomplete="list"
      aria-expanded={visible}
      aria-controls="{uid}-list"
      aria-activedescendant={visible && hi >= 0 ? `${uid}-opt-${hi}` : undefined}
      bind:value={draft}
      oninput={onInput}
      onfocus={onFocus}
      onblur={onBlur}
      onkeydown={onKeydown}
      placeholder="Buscar canal o pegar @handle, id UC… o URL"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
      enterkeyhint="search"
    />
    {#if draft}
      <button type="button" class="clear" aria-label="Borrar" onmousedown={(e) => e.preventDefault()} onclick={clear}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    {/if}
  </form>

  {#if visible}
    <!-- mousedown no quita el foco al input: el clic en una fila llega antes de que se cierre la lista -->
    <div class="panel" role="presentation" onmousedown={(e) => e.preventDefault()}>
      {#if showRecents}
        <div class="lbl">
          <span>Recientes</span>
          <button type="button" class="link" onclick={onClearRecents}>Borrar todo</button>
        </div>
      {/if}
      <ul id="{uid}-list" role="listbox" aria-label={showRecents ? "Canales recientes" : "Resultados"}>
        {#each rows as row, i (row.kind === "hit" ? `h:${row.hit.id}` : row.kind === "recent" ? `r:${row.item.key}` : row.kind)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <li
            id="{uid}-opt-{i}"
            role="option"
            aria-selected={i === hi}
            class:hi={i === hi}
            onmousemove={() => (active = i)}
            onclick={() => act(row)}
          >
            {#if row.kind === "open"}
              <span class="badge" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg></span>
              <span class="tx"><span class="nm">Abrir {row.value}</span><span class="mt">Ir directo al mosaico, sin buscar</span></span>
              {#if i === hi}<kbd>Enter</kbd>{/if}
            {:else if row.kind === "results"}
              <span class="badge" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg></span>
              <span class="tx"><span class="nm">Buscar canales: «{row.q}»</span><span class="mt">Ver todos los resultados</span></span>
              {#if i === hi}<kbd>Enter</kbd>{/if}
            {:else if row.kind === "hit"}
              <ChannelAvatar id={row.hit.id} title={row.hit.title} src={avatarUrl(row.hit, 36)} size={36} />
              <span class="tx"><span class="nm">{row.hit.title}</span><span class="mt">{meta(row.hit)}</span></span>
            {:else}
              <ChannelAvatar id={row.item.key} title={row.item.title} src={row.item.avatar} size={36} />
              <span class="tx"><span class="nm">{row.item.title}</span>{#if row.item.title !== row.item.key}<span class="mt">{row.item.key}</span>{/if}</span>
              <button
                type="button"
                class="rm"
                aria-label="Quitar {row.item.title} de recientes"
                tabindex="-1"
                onclick={(e) => {
                  e.stopPropagation();
                  onRemoveRecent(row.item.key);
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
              </button>
            {/if}
          </li>
        {/each}
      </ul>

      {#if loading}
        <div class="sk-list" aria-hidden="true">
          {#each [0, 1, 2] as n (n)}
            <div class="sk-row" style="--d:{n * 90}ms"><span class="sk-av"></span><span class="sk-tx"><span class="sk-l1"></span><span class="sk-l2"></span></span></div>
          {/each}
        </div>
      {:else if failedSuggest}
        <div class="note" role="status">
          <span>No se pudieron cargar sugerencias.</span>
          <button type="button" class="link" onclick={() => suggester.retry()}>Reintentar</button>
        </div>
      {:else if noHits}
        <div class="note" role="status"><span>Sin canales que coincidan. Prueba otras palabras.</span></div>
      {/if}
      {#if refreshing}<div class="bar-load" aria-hidden="true"></div>{/if}
    </div>
  {/if}
</div>

<style>
  .finder {
    position: relative;
    flex: 0 1 340px;
    min-width: 200px;
    margin: 0;
  }
  form {
    position: relative;
    margin: 0;
  }
  input {
    width: 100%;
    height: 36px;
    padding: 0 34px 0 34px;
    border: 1px solid transparent;
    border-radius: 10px;
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
    text-overflow: ellipsis;
    transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
  }
  input::placeholder {
    color: var(--text-3);
  }
  input:hover {
    background: var(--surface-3);
  }
  input:focus {
    outline: none;
    background: var(--surface);
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  .ico {
    position: absolute;
    left: 11px;
    top: 50%;
    translate: 0 -50%;
    color: var(--text-3);
    pointer-events: none;
  }
  .clear {
    position: absolute;
    right: 6px;
    top: 50%;
    translate: 0 -50%;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--text-3);
    cursor: pointer;
  }
  .clear:hover {
    background: var(--surface-3);
    color: var(--text);
  }

  /* Desplegable */
  .panel {
    position: absolute;
    z-index: 30;
    top: calc(100% + 6px);
    left: 0;
    width: max(100%, 380px);
    max-width: min(460px, calc(100vw - 24px));
    max-height: min(70vh, 460px);
    overflow: auto;
    padding: 6px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    box-shadow: var(--shadow-lift);
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 10px;
    border-radius: 10px;
    cursor: pointer;
  }
  li.hi {
    background: var(--accent-soft);
  }
  .tx {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
  }
  .nm,
  .mt {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .nm {
    font-weight: 600;
    color: var(--text);
  }
  .mt {
    font-size: 12px;
    color: var(--text-2);
  }
  .badge {
    flex: none;
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--accent-soft);
    color: var(--accent);
  }
  kbd {
    flex: none;
    padding: 1px 6px;
    border: 1px solid var(--border);
    border-radius: 5px;
    background: var(--surface);
    color: var(--text-3);
    font-family: var(--font-mono);
    font-size: 11px;
  }
  .lbl {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 10px 4px;
    color: var(--text-3);
    font-size: 12px;
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .link:hover {
    text-decoration: underline;
  }
  .rm {
    flex: none;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--text-3);
    cursor: pointer;
    opacity: 0;
  }
  li:hover .rm,
  li.hi .rm {
    opacity: 1;
  }
  .rm:hover {
    background: var(--surface-3);
    color: var(--text);
  }
  .note {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 10px;
    color: var(--text-2);
    font-size: 12px;
  }

  /* Cargando sugerencias */
  .sk-list {
    padding: 2px 0;
  }
  .sk-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 10px;
  }
  .sk-av,
  .sk-l1,
  .sk-l2 {
    background: linear-gradient(100deg, var(--surface-2) 30%, var(--surface-3) 50%, var(--surface-2) 70%);
    background-size: 300% 100%;
    animation: shimmer 1.4s ease-in-out infinite;
    animation-delay: var(--d);
  }
  .sk-av {
    flex: none;
    width: 36px;
    height: 36px;
    border-radius: 50%;
  }
  .sk-tx {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .sk-l1,
  .sk-l2 {
    height: 10px;
    border-radius: 5px;
  }
  .sk-l1 {
    width: 55%;
  }
  .sk-l2 {
    width: 35%;
  }
  .bar-load {
    height: 2px;
    margin: 2px 6px 0;
    border-radius: 2px;
    background: linear-gradient(90deg, transparent, var(--accent), transparent);
    background-size: 200% 100%;
    animation: shimmer 1s linear infinite;
  }
  @keyframes shimmer {
    from {
      background-position: 100% 0;
    }
    to {
      background-position: -100% 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .sk-av,
    .sk-l1,
    .sk-l2,
    .bar-load {
      animation: none;
    }
  }
  @media (max-width: 640px) {
    .finder {
      order: 1;
      flex: 1 1 0;
      min-width: 0;
    }
    .panel {
      width: 100%;
      max-width: none;
    }
    .rm {
      opacity: 1;
    }
  }
</style>
