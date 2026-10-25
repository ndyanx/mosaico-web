// Búsqueda por título (en el navegador, sobre los items ya descargados).
//
// - Sin mayúsculas ni tildes: "camion" encuentra "Camión".
// - Varias palabras = todas deben aparecer (en cualquier orden): "gato rojo" encuentra "El rojo del gato".
// - Sin términos devuelve el MISMO array (el grid distingue "misma lista" por identidad/longitud).
// - Conserva el orden, así que filtrar una lista que solo crece por el final da otra que también.
import type { ChannelEntry } from "../types.ts";

/** Tope de caracteres de la búsqueda (también en la URL). */
export const MAX_FILTER_LENGTH = 120;

/** minúsculas y sin diacríticos, para comparar. */
export function normalizeText(s: string): string {
  return s.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
}

/** Palabras de la búsqueda, ya normalizadas ([] = sin filtro). */
export function titleTerms(filter: string): string[] {
  return normalizeText(filter.slice(0, MAX_FILTER_LENGTH)).split(/\s+/).filter(Boolean);
}

// Normalizar un título cuesta más que buscar en él: se hace una sola vez por item.
const keys = new WeakMap<ChannelEntry, string>();
function keyOf(e: ChannelEntry): string {
  let k = keys.get(e);
  if (k === undefined) {
    k = normalizeText(e.title);
    keys.set(e, k);
  }
  return k;
}

export function matchesTitle(entry: ChannelEntry, terms: readonly string[]): boolean {
  if (terms.length === 0) return true;
  const key = keyOf(entry);
  return terms.every((t) => key.includes(t));
}

export function filterByTitle(entries: ChannelEntry[], filter: string): ChannelEntry[] {
  const terms = titleTerms(filter);
  return terms.length === 0 ? entries : entries.filter((e) => matchesTitle(e, terms));
}
