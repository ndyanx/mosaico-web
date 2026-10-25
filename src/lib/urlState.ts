// Estado de la lista <-> query string (la URL es compartible).
// Fase 4: lectura y escritura. La ControlBar edita la consulta y App la sincroniza con el historial.
import { MEMBERS, SECTIONS, SORTS } from "../types.ts";
import type { ListQuery, Section } from "../types.ts";

export const DEFAULT_QUERY: ListQuery = {
  channel: "",
  section: "videos",
  sort_by: "newest",
  members: "all",
};

/** Secciones donde el backend acepta `members` distinto de "all" (si no, responde 400). */
export const MEMBERS_SECTIONS: readonly Section[] = ["videos", "shorts"];

export function membersAllowed(section: Section): boolean {
  return MEMBERS_SECTIONS.includes(section);
}

/** Alias que el backend también acepta para `section`. */
const SECTION_ALIASES: Record<string, Section> = {
  video: "videos",
  short: "shorts",
  live: "streams",
  stream: "streams",
};

function pick<T extends string>(allowed: readonly T[], value: string | null, fallback: T): T {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Evita combinaciones que el backend rechaza: `members` solo aplica a videos y shorts. */
export function normalizeQuery(q: ListQuery): ListQuery {
  const channel = q.channel.trim();
  const members = membersAllowed(q.section) ? q.members : "all";
  return channel === q.channel && members === q.members ? q : { ...q, channel, members };
}

/** Lee `?channel=&section=&sort_by=&members=`; lo inválido cae al valor por defecto. */
export function parseListQuery(search: string): ListQuery {
  const p = new URLSearchParams(search);
  const rawSection = p.get("section");
  const section =
    rawSection !== null && Object.hasOwn(SECTION_ALIASES, rawSection)
      ? SECTION_ALIASES[rawSection]
      : pick(SECTIONS, rawSection, DEFAULT_QUERY.section);
  return normalizeQuery({
    channel: (p.get("channel") ?? "").trim(),
    section,
    sort_by: pick(SORTS, p.get("sort_by"), DEFAULT_QUERY.sort_by),
    members: pick(MEMBERS, p.get("members"), DEFAULT_QUERY.members),
  });
}

/**
 * Serializa la consulta: omite lo que vale el default (URLs cortas) y devuelve
 * "" o "?...". Es la inversa de parseListQuery: parse(toSearch(q)) equivale a normalizeQuery(q).
 */
export function toSearch(query: ListQuery): string {
  const q = normalizeQuery(query);
  const p = new URLSearchParams();
  if (q.channel) p.set("channel", q.channel);
  if (q.section !== DEFAULT_QUERY.section) p.set("section", q.section);
  if (q.sort_by !== DEFAULT_QUERY.sort_by) p.set("sort_by", q.sort_by);
  if (q.members !== DEFAULT_QUERY.members) p.set("members", q.members);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function sameQuery(a: ListQuery, b: ListQuery): boolean {
  return (
    a.channel === b.channel &&
    a.section === b.section &&
    a.sort_by === b.sort_by &&
    a.members === b.members
  );
}
