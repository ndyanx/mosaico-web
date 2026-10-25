// Cliente tipado de GET /v1/channel (una página para el masonry).
import type { ApiErrorBody, ApiIssue, ChannelPage, ListQuery } from "../types.ts";

/**
 * Base de la API.
 * - Desarrollo: "/api" (el proxy de Vite quita el prefijo y reenvía al backend local).
 * - Producción (Cloudflare Pages): URL del backend en Render, fijada al compilar con
 *   VITE_API_URL (p. ej. https://channel-feed-api.onrender.com). Requiere CORS_ORIGINS en el backend.
 */
export const API_BASE = ((import.meta.env?.VITE_API_URL as string | undefined)?.trim() || "/api").replace(/\/+$/, "");
/** Tamaño de página recomendado para el masonry. */
export const DEFAULT_PAGE_SIZE = 60;

/**
 * Error de la API o de la comunicación con ella.
 * - status 0: no hubo respuesta HTTP (backend caído, red).
 * - type: el `error.type` del backend (ValidationError, ...) o uno local
 *   (NetworkError, BadGateway, InvalidResponse).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly type: string;
  readonly issues: ApiIssue[];

  constructor(status: number, type: string, message: string, issues: ApiIssue[] = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.type = type;
    this.issues = issues;
  }
}

/** true si la petición fue cancelada con AbortController (no es un error real). */
export function isAbortError(e: unknown): boolean {
  return (
    typeof e === "object" && e !== null && (e as { name?: unknown }).name === "AbortError"
  );
}

export interface FetchPageOptions {
  /** Items ya cargados (default 0). */
  offset?: number;
  /** Tamaño de página (default DEFAULT_PAGE_SIZE). */
  max?: number;
  signal?: AbortSignal;
  /** Solo para pruebas; por defecto API_BASE. */
  baseUrl?: string;
}

export function buildPageUrl(query: ListQuery, opts: FetchPageOptions = {}): string {
  const params = new URLSearchParams({
    channel: query.channel.trim(),
    section: query.section,
    sort_by: query.sort_by,
    members: query.members,
    max: String(opts.max ?? DEFAULT_PAGE_SIZE),
    offset: String(opts.offset ?? 0),
    output: "full",
    reverse: "false",
  });
  return `${opts.baseUrl ?? API_BASE}/v1/channel?${params}`;
}

function isErrorBody(v: unknown): v is ApiErrorBody {
  if (typeof v !== "object" || v === null) return false;
  const e = (v as { error?: unknown }).error;
  return (
    typeof e === "object" &&
    e !== null &&
    typeof (e as { type?: unknown }).type === "string" &&
    typeof (e as { message?: unknown }).message === "string"
  );
}

function isChannelPage(v: unknown): v is ChannelPage {
  if (typeof v !== "object" || v === null) return false;
  const p = v as Partial<ChannelPage>;
  return (
    Array.isArray(p.items) &&
    typeof p.offset === "number" &&
    typeof p.has_more === "boolean" &&
    typeof p.updated_at === "string" &&
    p.items.every((it) => typeof it === "object" && it !== null && typeof it.id === "string")
  );
}

async function errorFromResponse(res: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = JSON.parse(await res.text());
  } catch {
    // cuerpo vacío o no JSON (p. ej. el proxy de Vite cuando el backend está caído)
  }
  if (isErrorBody(body)) {
    return new ApiError(res.status, body.error.type, body.error.message, body.error.issues ?? []);
  }
  if (res.status >= 500) {
    return new ApiError(
      res.status,
      "BadGateway",
      `El servidor no respondió correctamente (HTTP ${res.status}). Reintenta en unos segundos.`,
    );
  }
  return new ApiError(res.status, "HttpError", `Respuesta inesperada del servidor (HTTP ${res.status}).`);
}

/**
 * Pide una página. Lanza ApiError en fallos de API/red; si `signal` se aborta,
 * lanza el AbortError nativo (usa isAbortError para ignorarlo).
 */
export async function fetchChannelPage(
  query: ListQuery,
  opts: FetchPageOptions = {},
): Promise<ChannelPage> {
  if (!query.channel.trim()) {
    throw new ApiError(400, "ValidationError", "Indica un canal (@handle, UC... o URL).", [
      { param: "channel", message: "requerido" },
    ]);
  }

  let res: Response;
  try {
    res = await fetch(buildPageUrl(query, opts), {
      signal: opts.signal,
      headers: { accept: "application/json" },
    });
  } catch (e) {
    if (isAbortError(e)) throw e;
    throw new ApiError(0, "NetworkError", "No se pudo conectar con el servidor. Si llevaba un rato sin uso, puede estar despertando: reintenta en unos segundos.");
  }

  if (!res.ok) throw await errorFromResponse(res);

  let data: unknown;
  try {
    data = await res.json();
  } catch (e) {
    if (isAbortError(e)) throw e;
    throw new ApiError(res.status, "InvalidResponse", "El servidor devolvió una respuesta que no es JSON válido.");
  }
  if (!isChannelPage(data)) {
    throw new ApiError(res.status, "InvalidResponse", "El servidor devolvió una respuesta con formato inesperado.");
  }
  return data;
}
