// Normalización de items de la API -> ChannelEntry, y cálculo del alto de card.
import type { ChannelEntry, ChannelItem, ImageSource, Section } from "../types.ts";

/** Aspecto fijo (ancho / alto) cuando `cover` no trae dimensiones. */
const FALLBACK_ASPECT: Record<Section, number> = {
  videos: 16 / 9,
  streams: 16 / 9,
  shorts: 9 / 16,
};

/** Aspecto (ancho / alto) por defecto de una sección. */
export function fallbackAspect(section: Section): number {
  return FALLBACK_ASPECT[section];
}

function isDim(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n > 0;
}

function hasUrl(src: ImageSource | null | undefined): src is ImageSource {
  return !!src && typeof src.url === "string" && src.url.length > 0;
}

/**
 * Convierte un item de `/v1/channel?output=full` en la entrada que usa el masonry.
 * - `cover` define la imagen base y las dimensiones (si falta alguna dimensión -> 0/0).
 * - `frames`: se conservan solo si hay >= 2 urls distintas; si no, [] (sin hover).
 * - `animated`: la primera con url, o null.
 */
export function toEntry(item: ChannelItem, section: Section): ChannelEntry {
  const cover = hasUrl(item.cover) ? item.cover : null;
  const sized = cover !== null && isDim(cover.width) && isDim(cover.height);

  const frames = [...new Set((item.frames ?? []).filter((f) => typeof f === "string" && f.length > 0))];
  const animated = (item.animated ?? []).find(hasUrl) ?? null;

  return {
    id: item.id,
    url: item.url,
    title: typeof item.title === "string" ? item.title.trim() : "",
    section,
    width: sized ? cover!.width! : 0,
    height: sized ? cover!.height! : 0,
    coverUrl: cover ? cover.url : null,
    frames: frames.length >= 2 ? frames : [],
    animatedUrl: animated ? animated.url : null,
  };
}

export function toEntries(items: ChannelItem[], section: Section): ChannelEntry[] {
  return items.map((it) => toEntry(it, section));
}

/**
 * Alto (px) de la card para un ancho de columna:
 *   colWidth * cover.height / cover.width, o el aspecto fijo de la sección si no hay dimensiones.
 * El motor lo trunca a entero y lo limita a >= 1.
 */
export function getItemHeight(item: ChannelEntry, colWidth: number): number {
  if (item.width > 0 && item.height > 0) {
    return Math.round((colWidth * item.height) / item.width);
  }
  return Math.round(colWidth / FALLBACK_ASPECT[item.section]);
}
