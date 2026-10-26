// Búsqueda de canales: lógica sin Svelte (se prueba con node --test).
//
//   looksLikeChannel   ¿lo escrito es un canal concreto (@handle, UC…, URL)? -> abrirlo directo
//   createSuggester    sugerencias del desplegable: espera una pausa, cancela, cachea
//   createFinder       resultados paginados (scroll infinito), con dedupe por id
//   formatSubscribers / avatarUrl / initials / avatarHue   presentación de un canal
import { ApiError, MIN_SEARCH_CHARS, SEARCH_PAGE_SIZE, SUGGEST_SIZE, fetchChannelSearch, isAbortError } from "./api.ts";
import type { ChannelHit } from "../types.ts";

const UC_ID = /^UC[\w-]{22}$/;

/**
 * Si el texto es un canal concreto devuelve lo que va en `?channel=` ("@handle" o "UC…"); si no, null
 * (es texto para buscar). Una palabra suelta NO cuenta: "calming" se busca, "@calming" se abre.
 */
export function looksLikeChannel(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  const url = t.match(/youtube\.com\/(@[^/?#\s]+|channel\/(UC[\w-]{22}))/i);
  if (url) return url[2] ?? url[1] ?? null;
  if (/\s/.test(t)) return null;
  if (UC_ID.test(t)) return t;
  if (/^channel\/UC[\w-]{22}$/.test(t)) return t.slice(8);
  if (/^@[\w.-]{3,}$/.test(t)) return t;
  return null;
}

/** Lo que se pone en `?channel=` para abrir este canal: su @handle, o su id si no tiene. */
export function channelValueOf(hit: Pick<ChannelHit, "id" | "handle">): string {
  return hit.handle ?? hit.id;
}

/** Texto en la barra de la app, normalizado como lo hace el backend (espacios colapsados). */
export function cleanQuery(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// --------------------------------------------------------------------------- //
// Presentación
// --------------------------------------------------------------------------- //

const compact = new Intl.NumberFormat("es", { notation: "compact", maximumFractionDigits: 1 });

/** "36,3 mil suscriptores" | "1 suscriptor" | "" si el canal oculta el dato. */
export function formatSubscribers(hit: Pick<ChannelHit, "subscribers" | "subscribers_text">): string {
  const n = hit.subscribers;
  if (typeof n === "number" && Number.isFinite(n) && n >= 0) {
    return n === 1 ? "1 suscriptor" : `${compact.format(n).replace(/\u00a0/g, " ")} suscriptores`;
  }
  return hit.subscribers_text?.trim() ?? "";
}

/**
 * Avatar más chico que cubra `px` píxeles CSS (por la densidad de pantalla); si ninguno alcanza, el mayor.
 * YouTube manda 88 y 176: 88 para el desplegable, 176 para las tarjetas y pantallas retina.
 */
export function avatarUrl(hit: Pick<ChannelHit, "thumbnails">, px: number, dpr = defaultDpr()): string | null {
  const list = hit.thumbnails.filter((t) => typeof t.url === "string" && t.url.startsWith("https://"));
  if (!list.length) return null;
  const need = px * Math.max(1, dpr);
  const sorted = [...list].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return (sorted.find((t) => (t.width ?? 0) >= need) ?? sorted[sorted.length - 1]!).url;
}

function defaultDpr(): number {
  const d = (globalThis as { devicePixelRatio?: number }).devicePixelRatio;
  return typeof d === "number" && Number.isFinite(d) ? d : 1;
}

/** Hasta 2 iniciales para el avatar de respaldo ("calming corner ASMR" -> "CC"). */
export function initials(title: string): string {
  // Un apóstrofo no separa palabras: "Radit’s Calming Corner" -> RC (no RS).
  const words = title.normalize("NFKC").match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) ?? [];
  return words
    .slice(0, 2)
    .map((w) => [...w][0]!.toUpperCase())
    .join("");
}

/** Tono (0-359) estable para el avatar de respaldo: el mismo canal siempre tiene el mismo color. */
export function avatarHue(id: string): number {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
}

// --------------------------------------------------------------------------- //
// Resultados paginados
// --------------------------------------------------------------------------- //

export type FinderPhase = "idle" | "loading" | "ready" | "error";

export interface FinderState {
  /** Sube con cada búsqueda nueva. */
  generation: number;
  phase: FinderPhase;
  query: string;
  /** Deduplicados por id; solo se les añaden canales al final. */
  items: ChannelHit[];
  hasMore: boolean;
  loadingMore: boolean;
  /** Total aproximado de YouTube (no exacto); null si no lo dijo. */
  total: number | null;
  /** Error de la primera página. */
  error: ApiError | null;
  /** Error al pedir páginas siguientes (lo cargado sigue visible). */
  moreError: ApiError | null;
}

export interface FinderOptions {
  onChange: (state: FinderState) => void;
  pageSize?: number;
  /** Inyectable para pruebas. */
  fetchPage?: typeof fetchChannelSearch;
}

function finderInitial(generation: number, query = ""): FinderState {
  return { generation, phase: "idle", query, items: [], hasMore: false, loadingMore: false, total: null, error: null, moreError: null };
}

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  return new ApiError(0, "UnknownError", e instanceof Error ? e.message : "Error desconocido.");
}

export function createFinder(options: FinderOptions) {
  const pageSize = options.pageSize ?? SEARCH_PAGE_SIZE;
  const fetchPage = options.fetchPage ?? fetchChannelSearch;

  let generation = 0;
  let controller: AbortController | null = null;
  let seen = new Set<string>();
  /** Canales que el servidor ya entregó (con repetidos): siguiente `offset`. */
  let offset = 0;
  let state: FinderState = finderInitial(0);

  function emit(patch: Partial<FinderState>): void {
    state = { ...state, ...patch };
    options.onChange(state);
  }

  async function fetchNext(gen: number): Promise<void> {
    const q = state.query;
    const ctrl = new AbortController();
    controller = ctrl;
    try {
      const page = await fetchPage(q, { offset, max: pageSize, signal: ctrl.signal });
      if (gen !== generation) return;

      const fresh = page.items.filter((it) => {
        if (seen.has(it.id)) return false;
        seen.add(it.id);
        return true;
      });
      offset += page.items.length;

      // Página vacía con has_more=true: no se insiste (evita un bucle infinito).
      const hasMore = page.has_more && page.items.length > 0;
      const keepGoing = hasMore && fresh.length === 0;

      emit({
        phase: "ready",
        items: fresh.length ? [...state.items, ...fresh] : state.items,
        hasMore,
        loadingMore: keepGoing,
        total: page.total_estimate,
        error: null,
        moreError: null,
      });
      if (keepGoing) await fetchNext(gen);
    } catch (e) {
      if (gen !== generation || isAbortError(e)) return;
      const err = toApiError(e);
      if (state.phase === "loading") emit({ phase: "error", error: err, loadingMore: false });
      else emit({ loadingMore: false, moreError: err });
    } finally {
      if (controller === ctrl) controller = null;
    }
  }

  /** Empieza una búsqueda nueva (cancela la anterior). Repetir la misma no hace nada, salvo tras un error. */
  function search(text: string): void {
    const q = cleanQuery(text);
    if (q === state.query && state.phase !== "idle" && state.phase !== "error") return;
    controller?.abort();
    controller = null;
    generation++;
    seen = new Set();
    offset = 0;

    if (q.length < MIN_SEARCH_CHARS) {
      state = finderInitial(generation, q);
      options.onChange(state);
      return;
    }
    state = { ...finderInitial(generation, q), phase: "loading" };
    options.onChange(state);
    void fetchNext(generation);
  }

  /** Pide la página siguiente. Seguro de llamar muchas veces (p. ej. en cada scroll). */
  function loadMore(): void {
    if (state.phase !== "ready" || !state.hasMore || state.loadingMore || state.moreError) return;
    emit({ loadingMore: true });
    void fetchNext(generation);
  }

  function retry(): void {
    if (state.phase === "error") search(state.query);
    else if (state.moreError) {
      emit({ moreError: null });
      loadMore();
    }
  }

  function dispose(): void {
    generation++;
    controller?.abort();
    controller = null;
  }

  return { search, loadMore, retry, dispose, getState: () => state };
}

export type Finder = ReturnType<typeof createFinder>;

// --------------------------------------------------------------------------- //
// Sugerencias del desplegable
// --------------------------------------------------------------------------- //

export type SuggestPhase = "idle" | "loading" | "ready" | "error";

export interface SuggestState {
  phase: SuggestPhase;
  /** Texto (espacios colapsados) al que corresponden `items`. */
  query: string;
  items: ChannelHit[];
  error: ApiError | null;
}

export interface SuggesterOptions {
  onChange: (state: SuggestState) => void;
  /** Pausa tras la última tecla antes de pedir (default 300 ms). */
  delayMs?: number;
  size?: number;
  /** Búsquedas recordadas para no repetir peticiones al borrar o volver a escribir (default 20). */
  cacheSize?: number;
  /** Inyectable para pruebas. */
  fetchPage?: typeof fetchChannelSearch;
}

export function createSuggester(options: SuggesterOptions) {
  const delayMs = options.delayMs ?? 300;
  const size = options.size ?? SUGGEST_SIZE;
  const cacheSize = options.cacheSize ?? 20;
  const fetchPage = options.fetchPage ?? fetchChannelSearch;

  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | null = null;
  let seq = 0;
  let state: SuggestState = { phase: "idle", query: "", items: [], error: null };
  const cache = new Map<string, ChannelHit[]>(); // orden de inserción = LRU

  function emit(next: SuggestState): void {
    state = next;
    options.onChange(state);
  }

  function stop(): void {
    clearTimeout(timer);
    timer = undefined;
    controller?.abort();
    controller = null;
    seq++;
  }

  async function run(q: string, mySeq: number): Promise<void> {
    const ctrl = new AbortController();
    controller = ctrl;
    try {
      const page = await fetchPage(q, { offset: 0, max: size, signal: ctrl.signal });
      if (mySeq !== seq) return;
      const key = q.toLowerCase();
      cache.delete(key);
      cache.set(key, page.items);
      while (cache.size > cacheSize) cache.delete(cache.keys().next().value!);
      emit({ phase: "ready", query: q, items: page.items, error: null });
    } catch (e) {
      if (mySeq !== seq || isAbortError(e)) return;
      emit({ phase: "error", query: q, items: [], error: toApiError(e) });
    } finally {
      if (controller === ctrl) controller = null;
    }
  }

  /** Llamar en cada cambio del texto. Solo pide cuando es texto para buscar y hace una pausa. */
  function input(text: string): void {
    stop();
    const q = cleanQuery(text);
    if (q.length < MIN_SEARCH_CHARS || looksLikeChannel(q)) {
      emit({ phase: "idle", query: q, items: [], error: null });
      return;
    }
    const hit = cache.get(q.toLowerCase());
    if (hit) {
      emit({ phase: "ready", query: q, items: hit, error: null });
      return;
    }
    // Se conservan las sugerencias anteriores mientras llegan las nuevas (sin parpadeo).
    emit({ phase: "loading", query: q, items: state.items, error: null });
    const mySeq = seq;
    timer = setTimeout(() => void run(q, mySeq), delayMs);
  }

  /** Reintenta ya (sin pausa) tras un error. */
  function retry(): void {
    const q = state.query;
    if (state.phase !== "error" || q.length < MIN_SEARCH_CHARS) return;
    stop();
    emit({ phase: "loading", query: q, items: [], error: null });
    void run(q, seq);
  }

  /** Cancela lo pendiente y vacía las sugerencias. */
  function reset(): void {
    stop();
    emit({ phase: "idle", query: "", items: [], error: null });
  }

  return { input, retry, reset, dispose: stop, getState: () => state };
}

export type Suggester = ReturnType<typeof createSuggester>;
