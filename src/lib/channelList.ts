// Lista paginada de un canal: pide páginas, deduplica por id, cancela peticiones
// y descarta respuestas viejas. Sin Svelte: emite snapshots inmutables por `onChange`.
import { ApiError, DEFAULT_PAGE_SIZE, fetchChannelPage, isAbortError } from "./api.ts";
import { toEntries } from "./thumbs.ts";
import type { CacheStatus, ChannelEntry, ListQuery } from "./types.ts";

export type ListPhase =
  /** Sin canal que cargar. */
  | "idle"
  /** Primera página en vuelo. */
  | "loading"
  | "ready"
  /** Falló la primera página. */
  | "error";

export interface ListState {
  /** Sube con cada reset(); permite al grid distinguir "lista nueva" de "más items". */
  generation: number;
  phase: ListPhase;
  /** Deduplicados por id, solo se les añaden items al final (misma generación). */
  entries: ChannelEntry[];
  loadingMore: boolean;
  hasMore: boolean;
  total: number | null;
  cache: CacheStatus | null;
  /** Error de la primera página (phase "error"). */
  error: ApiError | null;
  /** Error al pedir páginas siguientes (la lista cargada sigue visible). */
  moreError: ApiError | null;
  /** `updated_at` cambió entre páginas: conviene recargar. */
  stale: boolean;
}

export interface ChannelListOptions {
  onChange: (state: ListState) => void;
  pageSize?: number;
  /** Inyectable para pruebas. */
  fetchPage?: typeof fetchChannelPage;
}

function initial(generation: number): ListState {
  return {
    generation,
    phase: "idle",
    entries: [],
    loadingMore: false,
    hasMore: false,
    total: null,
    cache: null,
    error: null,
    moreError: null,
    stale: false,
  };
}

function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  return new ApiError(0, "UnknownError", e instanceof Error ? e.message : "Error desconocido.");
}

export function createChannelList(options: ChannelListOptions) {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const fetchPage = options.fetchPage ?? fetchChannelPage;

  let query: ListQuery | null = null;
  let generation = 0;
  let controller: AbortController | null = null;
  let seen = new Set<string>();
  /** Items que el servidor ya nos entregó (con duplicados): siguiente `offset`. */
  let offset = 0;
  let firstUpdatedAt: string | null = null;
  let state: ListState = initial(0);

  function emit(patch: Partial<ListState>): void {
    state = { ...state, ...patch };
    options.onChange(state);
  }

  async function fetchNext(gen: number): Promise<void> {
    const q = query;
    if (!q) return;
    const ctrl = new AbortController();
    controller = ctrl;
    try {
      const page = await fetchPage(q, { offset, max: pageSize, signal: ctrl.signal });
      if (gen !== generation) return; // respuesta de una lista anterior

      // Deduplica por id (si entra un video nuevo mientras paginas, los offsets se corren).
      const fresh = page.items.filter((it) => {
        if (seen.has(it.id)) return false;
        seen.add(it.id);
        return true;
      });
      offset += page.items.length;
      if (firstUpdatedAt === null) firstUpdatedAt = page.updated_at;

      // Una página vacía con has_more=true no debe provocar un bucle infinito.
      const hasMore = page.has_more && page.items.length > 0;
      // Página compuesta solo de repetidos: el grid no cambiaría y no pediría más, seguimos nosotros.
      const keepGoing = hasMore && fresh.length === 0;

      emit({
        phase: "ready",
        entries: fresh.length ? [...state.entries, ...toEntries(fresh, q.section)] : state.entries,
        loadingMore: keepGoing,
        hasMore,
        total: page.total,
        cache: page.cache,
        error: null,
        moreError: null,
        stale: state.stale || page.updated_at !== firstUpdatedAt,
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

  /** Reinicia la lista (offset 0), cancela lo que haya en vuelo e ignora respuestas viejas. */
  function reset(next: ListQuery): void {
    controller?.abort();
    controller = null;
    generation++;
    seen = new Set();
    offset = 0;
    firstUpdatedAt = null;
    query = { ...next, channel: next.channel.trim() };

    if (!query.channel) {
      state = initial(generation);
      options.onChange(state);
      return;
    }
    state = { ...initial(generation), phase: "loading" };
    options.onChange(state);
    void fetchNext(generation);
  }

  /** Pide la página siguiente. Seguro de llamar muchas veces (p. ej. en cada scroll). */
  function loadMore(): void {
    if (state.phase !== "ready" || !state.hasMore || state.loadingMore || state.moreError) return;
    emit({ loadingMore: true });
    void fetchNext(generation);
  }

  /** Reintenta tras un error: recarga si falló la primera página; si no, la siguiente. */
  function retry(): void {
    if (state.phase === "error" && query) {
      reset(query);
    } else if (state.moreError) {
      emit({ moreError: null });
      loadMore();
    }
  }

  /** Recarga la misma consulta desde cero (p. ej. tras detectar `stale`). */
  function reload(): void {
    if (query) reset(query);
  }

  function dispose(): void {
    generation++;
    controller?.abort();
    controller = null;
  }

  return { reset, loadMore, retry, reload, dispose, getState: () => state };
}

export type ChannelList = ReturnType<typeof createChannelList>;
