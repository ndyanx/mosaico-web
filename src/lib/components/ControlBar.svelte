<script lang="ts">
  import { MEMBERS, SECTIONS, SORTS } from "../types.ts";
  import type { ListQuery, Members, Section, SortBy } from "../types.ts";
  import { membersAllowed } from "../urlState.ts";
  import { clampCols, MAX_COLS, MIN_COLS, type Theme } from "../prefs.ts";
  import { SITE_NAME } from "../site.ts";
  import type { RecentChannel } from "../recentChannels.ts";
  import type { ChannelHit } from "../types.ts";
  import ChannelSearchBox from "./ChannelSearchBox.svelte";

  interface Props {
    query: ListQuery;
    /** Cambio confirmado (Enter / selector). App decide si reinicia la lista. */
    onChange: (next: ListQuery) => void;
    /** Resumen (p. ej. "60 de 120"). */
    summary?: string;
    maxCols: number;
    onMaxCols: (n: number) => void;
    theme: Theme;
    onTheme: () => void;
    /** Reproducir en un modal (true) o abrir YouTube en otra pestaña (false). */
    embed: boolean;
    onEmbed: (v: boolean) => void;
    /** Búsqueda por título vigente (se aplica en el navegador, sin pedir nada a la API). */
    titleFilter: string;
    onTitleFilter: (v: string) => void;
    /** Búsqueda de canales abierta (`?find=`), "" si no hay. */
    find: string;
    recents: RecentChannel[];
    /** Abrir un canal en el mosaico (escrito a mano o elegido de la lista). */
    onOpenChannel: (value: string, from?: ChannelHit) => void;
    onShowResults: (q: string) => void;
    onRemoveRecent: (key: string) => void;
    onClearRecents: () => void;
  }
  let {
    query,
    onChange,
    summary = "",
    maxCols,
    onMaxCols,
    theme,
    onTheme,
    embed,
    onEmbed,
    titleFilter,
    onTitleFilter,
    find,
    recents,
    onOpenChannel,
    onShowResults,
    onRemoveRecent,
    onClearRecents,
  }: Props = $props();

  const SECTION_LABEL: Record<Section, string> = { videos: "Videos", shorts: "Shorts", streams: "Directos" };
  const SORT_LABEL: Record<SortBy, string> = { newest: "Más nuevos", popular: "Populares", oldest: "Más antiguos" };
  const MEMBERS_LABEL: Record<Members, string> = { all: "Todos", public: "Públicos", only: "Solo miembros" };
  const THEME_LABEL: Record<Theme, string> = { system: "Sistema", light: "Claro", dark: "Oscuro" };

  const canMembers = $derived(membersAllowed(query.section));

  // Título: se filtra mientras escribes, con una pausa corta para no re-maquetar en cada tecla.
  // Se resincroniza si la URL cambia (atrás/adelante) o si cambiar de canal lo vacía.
  const TITLE_DEBOUNCE_MS = 200;
  let titleDraft = $state("");
  let titleInput = $state<HTMLInputElement | null>(null);
  let titleTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    titleDraft = titleFilter;
  });
  $effect(() => () => clearTimeout(titleTimer));

  function onTitleInput(): void {
    clearTimeout(titleTimer);
    titleTimer = setTimeout(() => onTitleFilter(titleDraft.trim()), TITLE_DEBOUNCE_MS);
  }
  function clearTitle(): void {
    clearTimeout(titleTimer);
    titleDraft = "";
    onTitleFilter("");
    titleInput?.focus();
  }
</script>

<header class="bar">
  <a class="brand" href="/" aria-label={`${SITE_NAME}: inicio`}>
    <svg width="26" height="26" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="15" fill="var(--accent)" /><rect x="14" y="14" width="16" height="36" rx="4" fill="var(--on-accent)" /><rect x="34" y="14" width="16" height="20" rx="4" fill="var(--on-accent)" opacity=".9" /><rect x="34" y="38" width="16" height="12" rx="4" fill="var(--on-accent)" opacity=".65" /></svg>
    <span class="brand-name">{SITE_NAME}</span>
  </a>
  <ChannelSearchBox
    channel={query.channel}
    {find}
    {recents}
    {onOpenChannel}
    {onShowResults}
    {onRemoveRecent}
    {onClearRecents}
  />

  <form
    class="search title"
    role="search"
    onsubmit={(e) => {
      e.preventDefault();
      clearTimeout(titleTimer);
      onTitleFilter(titleDraft.trim());
    }}
  >
    <svg class="ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7V5h16v2M12 5v14M9 19h6" /></svg>
    <input
      bind:this={titleInput}
      type="text"
      name="title"
      aria-label="Buscar por título"
      bind:value={titleDraft}
      oninput={onTitleInput}
      onkeydown={(e) => {
        if (e.key === "Escape" && titleDraft) {
          e.preventDefault();
          clearTitle();
        }
      }}
      disabled={!query.channel || !!find}
      placeholder="Buscar por título…"
      autocomplete="off"
      autocapitalize="off"
      spellcheck="false"
    />
    {#if titleDraft}
      <button type="button" class="clear" aria-label="Borrar búsqueda por título" onclick={clearTitle}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    {/if}
  </form>

  <div class="seg" role="group" aria-label="Sección">
    {#each SECTIONS as s (s)}
      <button
        type="button"
        class:on={query.section === s}
        aria-pressed={query.section === s}
        onclick={() => onChange({ ...query, section: s })}>{SECTION_LABEL[s]}</button
      >
    {/each}
  </div>

  <div class="filters">
    <label class="pill">
      <span class="k">Orden</span>
      <select value={query.sort_by} onchange={(e) => onChange({ ...query, sort_by: e.currentTarget.value as SortBy })}>
        {#each SORTS as s (s)}<option value={s}>{SORT_LABEL[s]}</option>{/each}
      </select>
    </label>
    <label class="pill" class:off={!canMembers} title={canMembers ? "" : "Solo aplica a videos y shorts"}>
      <span class="k">Miembros</span>
      <select
        value={canMembers ? query.members : "all"}
        disabled={!canMembers}
        onchange={(e) => onChange({ ...query, members: e.currentTarget.value as Members })}
      >
        {#each MEMBERS as m (m)}<option value={m}>{MEMBERS_LABEL[m]}</option>{/each}
      </select>
    </label>
  </div>

  <div class="tools">
    {#if summary}<span class="summary">{summary}</span>{/if}

    <div class="cols" role="group" aria-label="Columnas máximas" title="Columnas máximas (en pantallas anchas)">
      <button type="button" class="icon-btn" aria-label="Menos columnas" disabled={maxCols <= MIN_COLS} onclick={() => onMaxCols(clampCols(maxCols - 1))}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14" /></svg>
      </button>
      <span class="n" aria-live="polite"
        ><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="3" width="7" height="18" rx="1.5" /><rect x="14" y="3" width="7" height="11" rx="1.5" /></svg>{maxCols}</span
      >
      <button type="button" class="icon-btn" aria-label="Más columnas" disabled={maxCols >= MAX_COLS} onclick={() => onMaxCols(clampCols(maxCols + 1))}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
      </button>
    </div>

    <button
      type="button"
      class="icon-btn toggle"
      class:on={embed}
      aria-pressed={embed}
      aria-label="Reproducir en un modal"
      title={embed
        ? query.members === "only"
          ? "Reproducir aquí: activo (los videos solo para miembros se abren en YouTube)"
          : "Reproducir aquí: activo. Clic = modal; Ctrl/Cmd+clic = YouTube"
        : "Reproducir aquí: desactivado (el clic abre YouTube)"}
      onclick={() => onEmbed(!embed)}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m10.5 9.5 4 2.5-4 2.5z" fill="currentColor" /></svg>
    </button>

    <button type="button" class="icon-btn theme" onclick={onTheme} aria-label={`Tema: ${THEME_LABEL[theme]}. Cambiar`} title={`Tema: ${THEME_LABEL[theme]}`}>
      {#if theme === "light"}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
      {:else if theme === "dark"}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
      {:else}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>
      {/if}
    </button>
  </div>
</header>

<style>
  .brand {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin-right: 4px;
    color: var(--text);
    text-decoration: none;
    font-weight: 700;
    letter-spacing: -0.01em;
  }
  .brand:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
    border-radius: 8px;
  }
  .bar {
    flex: none;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 12px;
    padding: 10px 20px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }

  /* Filtro por título (el buscador de canales tiene su propio componente) */
  .search {
    position: relative;
    flex: 0 1 320px;
    min-width: 200px;
    margin: 0;
  }
  .search input {
    width: 100%;
    height: 36px;
    padding: 0 34px 0 34px;
    border: 1px solid transparent;
    border-radius: 10px;
    background: var(--surface-2);
    color: var(--text);
    font: inherit;
    transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
  }
  .search input::placeholder {
    color: var(--text-3);
  }
  .search input:disabled {
    cursor: not-allowed;
    opacity: 0.55;
  }
  .search.title {
    flex-basis: 260px;
  }
  .search input:hover {
    background: var(--surface-3);
  }
  .search input:focus {
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

  /* Secciones: control segmentado */
  .seg {
    display: inline-flex;
    padding: 3px;
    gap: 2px;
    border-radius: 11px;
    background: var(--surface-2);
  }
  .seg button {
    height: 30px;
    padding: 0 14px;
    border: 0;
    border-radius: 8px;
    background: transparent;
    color: var(--text-2);
    font: inherit;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s, color 0.15s, box-shadow 0.15s;
  }
  .seg button:hover:not(.on) {
    color: var(--text);
  }
  .seg button.on {
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow);
  }
  .seg button:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  /* Filtros: píldoras con etiqueta + select */
  .filters {
    display: flex;
    gap: 8px;
    min-width: 0;
  }
  .pill {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 36px;
    min-width: 0;
    padding: 0 28px 0 12px;
    border-radius: 10px;
    background: var(--surface-2);
    transition: background 0.15s;
  }
  .pill:hover:not(.off) {
    background: var(--surface-3);
  }
  .pill::after {
    content: "";
    position: absolute;
    right: 11px;
    top: 50%;
    width: 6px;
    height: 6px;
    border-right: 1.6px solid var(--text-3);
    border-bottom: 1.6px solid var(--text-3);
    translate: 0 -70%;
    rotate: 45deg;
    pointer-events: none;
  }
  .pill.off {
    opacity: 0.45;
  }
  .k {
    color: var(--text-3);
    font-size: 12px;
  }
  .pill select {
    appearance: none;
    border: 0;
    background: transparent;
    color: var(--text);
    font: inherit;
    font-weight: 500;
    padding: 0;
    min-width: 0;
    text-overflow: ellipsis;
    cursor: pointer;
  }
  .pill select:disabled {
    cursor: not-allowed;
  }
  .pill select:focus-visible {
    outline: none;
  }
  .pill:has(select:focus-visible) {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .pill option {
    background: var(--surface);
    color: var(--text);
  }

  /* Herramientas a la derecha */
  .tools {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
  }
  .summary {
    margin-right: 6px;
    color: var(--text-3);
    font-family: var(--font-mono);
    font-size: 12px;
    white-space: nowrap;
  }
  .cols {
    display: inline-flex;
    align-items: center;
    padding: 0 2px;
    border-radius: 10px;
    background: var(--surface-2);
  }
  .cols .icon-btn {
    width: 30px;
    height: 34px;
  }
  .cols .n {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-width: 34px;
    justify-content: center;
    color: var(--text);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }
  .cols .n svg {
    color: var(--text-3);
  }

  .toggle.on {
    background: var(--accent-soft);
    color: var(--accent);
  }
  .toggle.on:hover:not(:disabled) {
    background: var(--accent-soft);
    color: var(--accent);
  }

  /* Tablet: sin el stepper (en pantallas chicas manda el responsive) */
  @media (max-width: 720px) {
    .cols {
      display: none;
    }
  }
  /* Móvil: buscador + tema arriba, secciones y filtros en filas completas */
  @media (max-width: 640px) {
    .brand-name {
      display: none;
    }
    .bar {
      padding: 10px 12px;
    }
    .search.title {
      order: 3;
      flex: 1 1 100%;
    }
    .tools {
      order: 2;
      margin-left: 0;
    }
    .summary {
      display: none;
    }
    .seg {
      order: 4;
      flex: 1 1 100%;
    }
    .seg button {
      flex: 1;
    }
    .filters {
      order: 5;
      flex: 1 1 100%;
    }
    .pill {
      flex: 1;
      justify-content: space-between;
    }
    .pill select {
      text-align: right;
      direction: rtl;
    }
  }
  /*
   * Móvil angosto (<= 400px: Galaxy A55 360, iPhone SE 375, iPhone 14 390). Con la etiqueta al lado,
   * «Orden» + «Miembros» suman ~375px (cada select mide lo que su opción más larga) y no caben: la
   * barra se ensanchaba, el navegador alejaba el zoom y quedaba una franja abajo. Aquí la etiqueta
   * va encima del valor y las dos píldoras caben de sobra (hasta en 320px).
   */
  @media (max-width: 400px) {
    .pill {
      flex-direction: column;
      align-items: flex-start;
      justify-content: center;
      gap: 0;
      height: 40px;
      padding: 0 26px 0 10px;
    }
    .pill::after {
      right: 10px;
    }
    .k {
      font-size: 10.5px;
      line-height: 1.1;
    }
    .pill select {
      width: 100%;
      line-height: 1.25;
      text-align: left;
      direction: ltr;
    }
  }
</style>
