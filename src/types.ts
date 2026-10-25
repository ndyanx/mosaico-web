// ---------------------------------------------------------------------------
// Contrato de la API (youtube-api). Ver README del backend.
// ---------------------------------------------------------------------------

export const SECTIONS = ["videos", "shorts", "streams"] as const;
export const SORTS = ["newest", "popular", "oldest"] as const;
export const MEMBERS = ["all", "public", "only"] as const;

export type Section = (typeof SECTIONS)[number];
export type SortBy = (typeof SORTS)[number];
export type Members = (typeof MEMBERS)[number];

/** Estado del caché del backend para la respuesta. */
export type CacheStatus = "miss" | "hit" | "stale" | "refresh";

/** Una imagen tal como la manda YouTube. width/height pueden venir null. */
export interface ImageSource {
  url: string;
  width: number | null;
  height: number | null;
}

export interface Thumbnail extends ImageSource {
  /** false = variante inferida (puede no existir). No usar como base. */
  original: boolean;
}

/** Item de `/v1/channel` con `output=full`. */
export interface ChannelItem {
  id: string;
  url: string;
  /** Título del video ("" si el backend no pudo leerlo). Ausente en backends anteriores a este campo. */
  title?: string;
  thumbnails: Thumbnail[];
  /** Miniatura base de la card (la mayor entre las originales). null = sin miniatura conocida. */
  cover: ImageSource | null;
  /** Solo shorts: mismo tamaño que `cover`; frames[0] === cover.url. El resto puede no existir. */
  frames: string[];
  /** Videos/streams: webp animado para el hover. [] = sin hover. */
  animated: ImageSource[];
  params: Record<string, never>;
}

/** Respuesta de `GET /v1/channel`. */
export interface ChannelPage {
  channel: string;
  section: Section;
  offset: number;
  count: number;
  /** null hasta que el canal se ha descargado entero. */
  total: number | null;
  has_more: boolean;
  cache: CacheStatus;
  /** ISO 8601: momento en que se bajó la primera página de la lista. */
  updated_at: string;
  items: ChannelItem[];
}

export interface ApiIssue {
  param: string;
  message: string;
}

/** Cuerpo de error del backend (400 / 404 / 502 / 500). */
export interface ApiErrorBody {
  error: {
    type: string;
    message: string;
    issues?: ApiIssue[];
  };
}

/** Parámetros que definen una lista (cambiar cualquiera reinicia el masonry). */
export interface ListQuery {
  channel: string;
  section: Section;
  sort_by: SortBy;
  members: Members;
}

// ---------------------------------------------------------------------------
// Modelo de la app (lo que consumen el motor y las cards)
// ---------------------------------------------------------------------------

/**
 * Item ya normalizado para el masonry (ver lib/thumbs.ts: toEntry).
 * `width`/`height` son las dimensiones de `cover` (0 = desconocidas, el alto de
 * la card cae entonces al aspecto fijo de la sección).
 */
export interface ChannelEntry extends MediaEntry {
  /** Enlace al video/short/stream (se abre en pestaña nueva). */
  url: string;
  /** Título para mostrar y buscar ("" = desconocido). */
  title: string;
  section: Section;
  /** Miniatura base de la card. null = sin miniatura (placeholder). */
  coverUrl: string | null;
  /** Shorts: >= 2 urls para animar el hover (frames[0] === coverUrl); si no, []. */
  frames: string[];
  /** Videos/streams: webp animado del hover; null = sin hover. */
  animatedUrl: string | null;
}

// ---------------------------------------------------------------------------
// Motor masonry (lib/virtualMasonry.ts)
// ---------------------------------------------------------------------------

/**
 * Mínimo que el motor necesita de cada item. `width`/`height` son las
 * dimensiones intrínsecas de la imagen base (0 = desconocidas); `refreshItems`
 * las usa para detectar que un item ganó dimensiones y hay que re-maquetar.
 */
export interface MediaEntry {
  id: string;
  width: number;
  height: number;
}

/** Posición calculada de un item dentro del canvas del masonry. */
export interface LayoutItem<T extends MediaEntry = MediaEntry> {
  key: string;
  item: T;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Lo que el motor emite a cada cambio (scroll, resize, nuevos items). */
export interface MasonryState<T extends MediaEntry = MediaEntry> {
  colCount: number;
  colWidth: number;
  scrollTop: number;
  viewportHeight: number;
  containerHeight: number;
  visibleItems: LayoutItem<T>[];
}

/** Zona en la que entran items: viewport, margen cercano o fuera de ambos. */
export type PrefetchZone = "visible" | "lookahead" | "idle";

export interface VirtualMasonryOptions<T extends MediaEntry = MediaEntry> {
  /** Alto de la card (px) para un ancho de columna dado. Requerido. */
  getItemHeight: (item: T, colWidth: number) => number;
  /** Clave estable del item (default: item.id). */
  getItemKey?: (item: T) => string;
  /** { anchoMaxContenedor: columnas }; la clave Infinity es el fallback. */
  breakpoints?: Record<number, number>;
  gap?: number;
  /** Margen extra (px) alrededor del viewport que se sigue renderizando. */
  viewportMargin?: number;
  /** Margen (px) para la zona "lookahead" del pipeline. */
  lookahead?: number;
  /** ms sin actividad antes de lanzar la zona "idle". */
  idleDelay?: number;
  onItemsEntered?: ((items: T[], zone: PrefetchZone) => void) | null;
  /** Padding horizontal total del contenedor scrolleable (izq + der). */
  paddingX?: number;
}
