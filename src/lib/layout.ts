// Columnas: el ancho del contenedor decide (responsive) y `maxCols` pone el tope.
// Mismos cortes que el motor por defecto; el valor se limita a maxCols.
import { clampCols } from "./prefs.ts";

const BASE: ReadonlyArray<readonly [number, number]> = [
  [480, 2],
  [720, 3],
  [1024, 4],
  [1440, 5],
  [Infinity, 6],
];

/** `breakpoints` para createVirtualMasonry: { ancho_máximo: columnas }. */
export function columnBreakpoints(maxCols: number): Record<number, number> {
  const max = clampCols(maxCols);
  const out: Record<number, number> = {};
  for (const [w, cols] of BASE) out[w] = Math.min(cols, max);
  return out;
}

/** Columnas resultantes para un ancho útil (misma regla que el motor: primer corte con w < corte). */
export function columnsFor(width: number, maxCols: number): number {
  const bp = columnBreakpoints(maxCols);
  for (const [w] of BASE) if (width < w) return bp[w];
  return bp[Infinity];
}
