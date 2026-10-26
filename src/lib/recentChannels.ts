// Canales recientes (los que abriste desde la barra). Persisten en localStorage, solo en este navegador.
import { avatarUrl, channelValueOf } from "./channelSearch.ts";
import type { ChannelHit } from "../types.ts";

export const RECENTS_KEY = "ytgallery:recent-channels";
export const MAX_RECENTS = 8;

export interface RecentChannel {
  /** Lo que va en `?channel=`: "@handle" o id UC… */
  key: string;
  title: string;
  /** Avatar https de YouTube, o null (se muestran las iniciales). */
  avatar: string | null;
}

/** Los @handle no distinguen mayúsculas; los ids UC… sí. */
const same = (a: string, b: string) => (a.startsWith("@") ? a.toLowerCase() === b.toLowerCase() : a === b);

export function recentFromHit(hit: ChannelHit): RecentChannel {
  return { key: channelValueOf(hit), title: hit.title || channelValueOf(hit), avatar: avatarUrl(hit, 88, 1) };
}

/** Canal abierto escribiendo su @handle / id / URL (no tenemos nombre ni avatar). */
export function recentFromValue(value: string): RecentChannel {
  return { key: value, title: value, avatar: null };
}

/**
 * Pone `item` al principio. Si ya estaba, se mueve y conserva el nombre y el avatar que tuviera
 * cuando el nuevo no los trae (abrir "@canal" a mano no debe borrar el avatar guardado).
 */
export function addRecent(list: readonly RecentChannel[], item: RecentChannel): RecentChannel[] {
  const old = list.find((r) => same(r.key, item.key));
  const merged: RecentChannel = old
    ? { key: item.key, title: item.avatar || item.title !== item.key ? item.title : old.title, avatar: item.avatar ?? old.avatar }
    : item;
  return [merged, ...list.filter((r) => !same(r.key, item.key))].slice(0, MAX_RECENTS);
}

export function removeRecent(list: readonly RecentChannel[], key: string): RecentChannel[] {
  return list.filter((r) => !same(r.key, key));
}

export function parseRecents(raw: string | null | undefined): RecentChannel[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    if (!Array.isArray(v)) return [];
    const out: RecentChannel[] = [];
    for (const r of v) {
      if (typeof r !== "object" || r === null) continue;
      const o = r as Record<string, unknown>;
      if (typeof o.key !== "string" || !o.key || o.key.length > 120) continue;
      if (out.some((x) => same(x.key, o.key as string))) continue;
      const title = typeof o.title === "string" && o.title ? o.title.slice(0, 120) : o.key;
      const avatar = typeof o.avatar === "string" && o.avatar.startsWith("https://") ? o.avatar : null;
      out.push({ key: o.key, title, avatar });
    }
    return out.slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

type ReadStore = Pick<Storage, "getItem">;
type WriteStore = Pick<Storage, "setItem">;

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** localStorage puede no existir o lanzar (modo privado, cuota): siempre cae a una lista vacía. */
export function loadRecents(storage: ReadStore | null = safeStorage()): RecentChannel[] {
  try {
    return parseRecents(storage?.getItem(RECENTS_KEY));
  } catch {
    return [];
  }
}

export function saveRecents(list: readonly RecentChannel[], storage: WriteStore | null = safeStorage()): void {
  try {
    storage?.setItem(RECENTS_KEY, JSON.stringify(list));
  } catch {
    /* sin persistencia: valen para esta sesión */
  }
}
