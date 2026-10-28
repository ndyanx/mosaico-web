// Reproducción embebida (modal) en lugar de abrir YouTube en otra pestaña.
import type { ChannelEntry, ListQuery } from "./types.ts";

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** Id de video de YouTube validado (11 caracteres), de `entry.id` o, si no sirve, de la URL. */
export function videoIdOf(entry: Pick<ChannelEntry, "id" | "url">): string | null {
  if (VIDEO_ID.test(entry.id)) return entry.id;
  try {
    const u = new URL(entry.url);
    const fromQuery = u.searchParams.get("v");
    if (fromQuery && VIDEO_ID.test(fromQuery)) return fromQuery;
    const seg = u.pathname.split("/").filter(Boolean);
    const last = seg[seg.length - 1];
    if (last && VIDEO_ID.test(last)) return last;
  } catch {
    /* URL inválida */
  }
  return null;
}

/** URL del iframe (youtube-nocookie: sin cookies de seguimiento hasta que se reproduce). */
export function embedUrl(entry: Pick<ChannelEntry, "id" | "url">): string | null {
  const id = videoIdOf(entry);
  if (!id) return null;
  const p = new URLSearchParams({ autoplay: "1", rel: "0", playsinline: "1" });
  return `https://www.youtube-nocookie.com/embed/${id}?${p}`;
}

/**
 * ¿Conviene embeber? Los videos solo para miembros no se pueden reproducir fuera de YouTube,
 * así que con members=only se abre directamente en YouTube.
 */
export function canEmbed(entry: Pick<ChannelEntry, "id" | "url">, query: Pick<ListQuery, "members">): boolean {
  return query.members !== "only" && videoIdOf(entry) !== null;
}

/** Click normal (izquierdo, sin teclas): abre el modal. Ctrl/Cmd/Shift/Alt o botón medio: pestaña nueva como siempre. */
export function isPlainClick(e: Pick<MouseEvent, "button" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">): boolean {
  return e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey;
}
