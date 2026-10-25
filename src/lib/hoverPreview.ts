// Preview al pasar el cursor sobre una card.
// - videos/streams: webp animado (`animatedUrl`) en lugar de la miniatura.
// - shorts: alterna `frames` (mismo tamaño que `cover`); solo los que existen de verdad.
// Regla de oro: NUNCA se reemplaza la miniatura salvo que el recurso se haya cargado y validado.
// La lógica es independiente de Svelte y del DOM (el `probe` se inyecta) para poder probarla.
import type { ChannelEntry } from "../types.ts";

export interface ProbeResult {
  width: number;
  height: number;
}
/** Carga una imagen sin mostrarla. null = no cargó o se canceló. */
export type ImageProbe = (url: string, signal: AbortSignal) => Promise<ProbeResult | null>;

export const HOVER_DELAY_MS = 150;
export const FRAME_INTERVAL_MS = 700;
/** Tiempo máximo para bajar el webp; pasado esto se descarta (no aparece tarde, de golpe). */
export const ANIMATED_TIMEOUT_MS = 8000;
export const ANIMATED_RETRY_MS = 400;
/** Un webp "cargado" más angosto que esto es un placeholder/píxel, no una animación. */
export const MIN_ANIMATED_WIDTH = 100;
export const FAILURE_TTL_MS = 60_000;

/** Probe real (navegador): usa Image y respeta la cancelación liberando la descarga. */
export const probeImage: ImageProbe = (url, signal) =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve(null);
    const img = new Image();
    const done = (r: ProbeResult | null) => {
      signal.removeEventListener("abort", onAbort);
      img.onload = img.onerror = null;
      resolve(r);
    };
    const onAbort = () => {
      img.src = "";
      done(null);
    };
    img.referrerPolicy = "no-referrer";
    img.decoding = "async";
    img.onload = () =>
      done(img.naturalWidth > 0 ? { width: img.naturalWidth, height: img.naturalHeight } : null);
    img.onerror = () => done(null);
    signal.addEventListener("abort", onAbort, { once: true });
    img.src = url;
  });

/** Caché (LRU simple) de los frames válidos por id: el segundo hover es instantáneo. */
export function createFrameCache(max = 400) {
  const map = new Map<string, string[]>();
  return {
    get(id: string): string[] | undefined {
      const v = map.get(id);
      if (v) {
        map.delete(id);
        map.set(id, v);
      }
      return v;
    },
    set(id: string, frames: string[]): void {
      map.delete(id);
      map.set(id, frames);
      if (map.size > max) map.delete(map.keys().next().value!);
    },
    get size() {
      return map.size;
    },
  };
}
export type FrameCache = ReturnType<typeof createFrameCache>;
export const sharedFrameCache: FrameCache = createFrameCache();

/** Recuerda un rato qué animaciones fallaron: no se reintenta (ni se muestra "cargando") en cada hover. */
export function createFailureMemo(ttlMs = FAILURE_TTL_MS, now: () => number = Date.now, max = 2000) {
  const map = new Map<string, number>();
  return {
    has(id: string): boolean {
      const at = map.get(id);
      if (at === undefined) return false;
      if (now() - at >= ttlMs) {
        map.delete(id);
        return false;
      }
      return true;
    },
    add(id: string): void {
      map.delete(id);
      map.set(id, now());
      if (map.size > max) map.delete(map.keys().next().value!);
    },
  };
}
export type FailureMemo = ReturnType<typeof createFailureMemo>;
export const sharedFailureMemo: FailureMemo = createFailureMemo();

/**
 * Frames reproducibles de un short: `[cover, ...los que cargan]`. Descarta los inexistentes
 * y los placeholders de YouTube (imagen mucho más pequeña que `cover`). [] = sin preview.
 */
export async function resolveFrames(
  entry: ChannelEntry,
  probe: ImageProbe,
  signal: AbortSignal,
  cache: FrameCache = sharedFrameCache,
): Promise<string[]> {
  const cached = cache.get(entry.id);
  if (cached) return cached;
  const [first, ...rest] = entry.frames;
  if (!first || rest.length === 0) return [];
  const minWidth = entry.width > 0 ? entry.width * 0.75 : 200;
  const results = await Promise.all(rest.map((u) => probe(u, signal)));
  if (signal.aborted) return [];
  const ok = rest.filter((_, i) => {
    const r = results[i];
    return r !== null && r.width >= minWidth;
  });
  const frames = ok.length ? [first, ...ok] : [];
  cache.set(entry.id, frames); // también cachea "ninguno": no se reintenta en cada hover
  return frames;
}

export type FailKind = "animated" | "frames";

export interface PreviewDeps {
  probe?: ImageProbe;
  cache?: FrameCache;
  failed?: FailureMemo;
  delay?: number;
  interval?: number;
  timeoutMs?: number;
  retryMs?: number;
  /** prefers-reduced-motion: sin animación; en shorts un único cambio estático. */
  reducedMotion?: boolean;
  /** true mientras se descarga el preview (la card puede mostrar un indicador). */
  onLoading?: (loading: boolean) => void;
  /** El recurso no sirvió (error, timeout, demasiado pequeño): la miniatura se queda. */
  onFail?: (kind: FailKind, entry: ChannelEntry, reason: string) => void;
}

/** Lo que la card muestra encima de la miniatura. null = nada. */
export type PreviewState = { kind: "animated" | "frame"; url: string } | null;

type Timed = ProbeResult | "timeout" | null;

export function createHoverPreview(
  source: ChannelEntry | (() => ChannelEntry),
  onChange: (s: PreviewState) => void,
  deps: PreviewDeps = {},
) {
  const probe = deps.probe ?? probeImage;
  const failed = deps.failed ?? sharedFailureMemo;
  const delay = deps.delay ?? HOVER_DELAY_MS;
  const interval = deps.interval ?? FRAME_INTERVAL_MS;
  const timeoutMs = deps.timeoutMs ?? ANIMATED_TIMEOUT_MS;
  const retryMs = deps.retryMs ?? ANIMATED_RETRY_MS;
  // La entry puede reemplazarse (refreshItems): siempre se lee la vigente.
  const current = (): ChannelEntry => (typeof source === "function" ? source() : source);

  let timer: ReturnType<typeof setTimeout> | null = null;
  let cycle: ReturnType<typeof setInterval> | null = null;
  let ctrl: AbortController | null = null;
  let active = false;

  const setLoading = (v: boolean) => deps.onLoading?.(v);

  function sleep(ms: number, signal: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => {
      if (signal.aborted) return resolve(false);
      const t = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve(true);
      }, ms);
      const onAbort = () => {
        clearTimeout(t);
        resolve(false);
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  async function probeTimed(url: string, signal: AbortSignal): Promise<Timed> {
    const child = new AbortController();
    const onParent = () => child.abort();
    signal.addEventListener("abort", onParent, { once: true });
    let timedOut = false;
    const t = setTimeout(() => {
      timedOut = true;
      child.abort();
    }, timeoutMs);
    try {
      const r = await probe(url, child.signal);
      return timedOut ? "timeout" : r;
    } finally {
      clearTimeout(t);
      signal.removeEventListener("abort", onParent);
    }
  }

  /** true = el webp cargó y es una imagen real. Reintenta una vez ante un fallo rápido. */
  async function loadAnimated(e: ChannelEntry, url: string, c: AbortController): Promise<boolean> {
    let reason = "error";
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await probeTimed(url, c.signal);
      if (c.signal.aborted) return false;
      if (r === "timeout") {
        reason = "timeout";
        break; // no se espera otro timeout completo
      }
      if (r && r.width >= MIN_ANIMATED_WIDTH) return true;
      reason = r ? `demasiado pequeño (${r.width}px)` : "no cargó";
      if (attempt === 0 && !(await sleep(retryMs, c.signal))) return false;
    }
    failed.add(e.id);
    deps.onFail?.("animated", e, reason);
    return false;
  }

  async function runFrames(e: ChannelEntry, c: AbortController): Promise<void> {
    const frames = await resolveFrames(e, probe, c.signal, deps.cache);
    if (c.signal.aborted) return;
    if (frames.length < 2) {
      deps.onFail?.("frames", e, "ningún frame válido");
      return;
    }
    let i = 1;
    onChange({ kind: "frame", url: frames[i] });
    if (deps.reducedMotion) return;
    cycle = setInterval(() => {
      i = (i + 1) % frames.length;
      onChange({ kind: "frame", url: frames[i] });
    }, interval);
  }

  async function run(c: AbortController): Promise<void> {
    const e = current();
    setLoading(true);
    try {
      if (e.animatedUrl) {
        if (deps.reducedMotion) return;
        if (!failed.has(e.id)) {
          if (await loadAnimated(e, e.animatedUrl, c)) {
            if (!c.signal.aborted) onChange({ kind: "animated", url: e.animatedUrl });
            return;
          }
          if (c.signal.aborted) return;
        }
        // Animación inservible: si hay frames, se usan en su lugar; si no, se queda la miniatura.
      }
      if (e.frames.length >= 2) await runFrames(e, c);
    } finally {
      setLoading(false);
    }
  }

  return {
    /** Llamar al entrar el cursor / foco. Idempotente. */
    start(): void {
      const e = current();
      if (active || !(e.animatedUrl || e.frames.length >= 2)) return;
      active = true;
      timer = setTimeout(() => {
        timer = null;
        ctrl = new AbortController();
        void run(ctrl);
      }, delay);
    },
    /** Llamar al salir. Cancela descargas pendientes y detiene el bucle. */
    stop(): void {
      if (!active) return;
      active = false;
      if (timer) clearTimeout(timer);
      if (cycle) clearInterval(cycle);
      timer = cycle = null;
      ctrl?.abort();
      ctrl = null;
      setLoading(false);
      onChange(null);
    },
  };
}
