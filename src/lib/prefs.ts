// Preferencias de vista (no van en la URL): tema y máximo de columnas. Persisten en localStorage.
export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export const MIN_COLS = 2;
export const MAX_COLS = 6;
export const DEFAULT_COLS = 4;
export const PREFS_KEY = "ytgallery:prefs";

export interface Prefs {
  theme: Theme;
  /** Tope de columnas en pantallas anchas; en pantallas chicas manda el responsive. */
  maxCols: number;
  /** true = clic abre un modal con el video embebido; false = abre YouTube en otra pestaña. */
  embed: boolean;
}
export const DEFAULT_PREFS: Prefs = { theme: "system", maxCols: DEFAULT_COLS, embed: true };

export function clampCols(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n)) return DEFAULT_COLS;
  return Math.min(MAX_COLS, Math.max(MIN_COLS, Math.round(n)));
}

export function parsePrefs(raw: string | null | undefined): Prefs {
  if (!raw) return { ...DEFAULT_PREFS };
  try {
    const o = JSON.parse(raw) as Record<string, unknown> | null;
    const theme = (THEMES as readonly unknown[]).includes(o?.theme) ? (o!.theme as Theme) : DEFAULT_PREFS.theme;
    const embed = typeof o?.embed === "boolean" ? o.embed : DEFAULT_PREFS.embed;
    return { theme, maxCols: clampCols(o?.maxCols ?? DEFAULT_COLS), embed };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

type ReadStore = Pick<Storage, "getItem">;
type WriteStore = Pick<Storage, "setItem">;

/** localStorage puede no existir o lanzar (modo privado, cuota): siempre cae a los defaults. */
export function loadPrefs(storage: ReadStore | null = safeStorage()): Prefs {
  try {
    return parsePrefs(storage?.getItem(PREFS_KEY));
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function savePrefs(p: Prefs, storage: WriteStore | null = safeStorage()): void {
  try {
    storage?.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* sin persistencia: la preferencia vale para esta sesión */
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function nextTheme(t: Theme): Theme {
  return THEMES[(THEMES.indexOf(t) + 1) % THEMES.length];
}

/** "system" quita el atributo y deja mandar a prefers-color-scheme. */
export function applyTheme(t: Theme, root: HTMLElement = document.documentElement): void {
  if (t === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", t);
}
