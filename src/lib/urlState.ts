// Estado de la lista <-> query string (la URL es compartible).
// Fase 4: lectura y escritura. La ControlBar edita la consulta y App la sincroniza con el historial.
import { MEMBERS, SECTIONS, SORTS } from "./types.ts";
import type { ListQuery, Section } from "./types.ts";
import { MAX_FILTER_LENGTH } from "./titleSearch.ts";

/** Tope de caracteres de la búsqueda de canales (`?find=`); el backend acepta hasta 100. */
export const MAX_FIND_LENGTH = 100;

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
 * Búsqueda por título (`?q=`). No es parte de la consulta a la API: se filtra en el
 * navegador, así que cambiarla no reinicia la lista.
 */
export function parseTitleFilter(search: string): string {
  return (new URLSearchParams(search).get("q") ?? "").trim().slice(0, MAX_FILTER_LENGTH);
}

/**
 * Búsqueda de canales abierta (`?find=`): muestra la página de resultados en lugar del mosaico.
 * No es parte de la consulta a la lista: el canal que se estaba viendo se conserva en la URL.
 */
export function parseFind(search: string): string {
  return (new URLSearchParams(search).get("find") ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_FIND_LENGTH);
}

/**
 * Serializa la consulta: omite lo que vale el default (URLs cortas) y devuelve
 * "" o "?..." (con "@" literal, no "%40"). Es la inversa de parseListQuery: parse(toSearch(q)) equivale a normalizeQuery(q).
 * `titleFilter` (opcional) se añade como `q`; `find` (opcional), como `find`.
 */
export function toSearch(query: ListQuery, titleFilter = "", find = ""): string {
  const q = normalizeQuery(query);
  const p = new URLSearchParams();
  if (q.channel) p.set("channel", q.channel);
  if (q.section !== DEFAULT_QUERY.section) p.set("section", q.section);
  if (q.sort_by !== DEFAULT_QUERY.sort_by) p.set("sort_by", q.sort_by);
  if (q.members !== DEFAULT_QUERY.members) p.set("members", q.members);
  const f = titleFilter.trim().slice(0, MAX_FILTER_LENGTH);
  if (f) p.set("q", f);
  const fd = find.replace(/\s+/g, " ").trim().slice(0, MAX_FIND_LENGTH);
  if (fd) p.set("find", fd);
  // La "@" es valida dentro de un query string: se deja literal para que el enlace se lea mejor
  // (?channel=@canal en vez de ?channel=%40canal). URLSearchParams decodifica las dos formas.
  const s = p.toString().replaceAll("%40", "@");
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
