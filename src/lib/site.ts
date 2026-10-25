// Identidad del sitio: un solo lugar para el nombre (titulo de pestana, barra, etc.).
// El <title> inicial y las metaetiquetas estan en index.html y deben coincidir con esto.
export const SITE_NAME = "Mosaico";
export const SITE_TAGLINE = "Galería de videos, shorts y directos de cualquier canal de YouTube";

/** Título de la pestaña: "Mosaico · Galería…" sin canal, o "@canal · Mosaico" con canal. */
export function titleFor(channel: string): string {
  const c = channel.trim();
  if (!c) return `${SITE_NAME} · Galería de canales de YouTube`;
  // Recorta URLs largas: la pestaña solo muestra ~30 caracteres.
  const short = c.length > 40 ? `${c.slice(0, 39)}…` : c;
  return `${short} · ${SITE_NAME}`;
}
