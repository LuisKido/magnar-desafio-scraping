/**
 * Cliente HTTP sobre axios con:
 *  - Manejo manual de cookies de sesión (JSESSIONID). Se mantiene una sola
 *    dependencia de red (axios) tal como sugiere el desafío, sin librerías de
 *    navegador ni jars externos.
 *  - Reintentos con backoff exponencial + jitter, orientado a HTTP 429
 *    (Too Many Requests) y a errores transitorios de servidor/red.
 */

import axios, {
  AxiosInstance,
  AxiosRequestConfig,
  AxiosResponse,
  isAxiosError,
} from 'axios';
import { HTTP, RETRY } from './config';
import { logger, sleep } from './logger';

/** Error lanzado cuando una request agota todos los reintentos. */
export class RequestFailedError extends Error {
  constructor(
    message: string,
    public readonly status: number | undefined,
    public readonly attempts: number,
  ) {
    super(message);
    this.name = 'RequestFailedError';
  }
}

export class HttpClient {
  private readonly axios: AxiosInstance;
  /** Cookies acumuladas de la sesión, indexadas por nombre. */
  private cookies = new Map<string, string>();

  constructor() {
    this.axios = axios.create({
      timeout: HTTP.timeoutMs,
      // No lanzar por códigos != 2xx: gestionamos el status manualmente para
      // poder distinguir 429 y aplicar backoff.
      validateStatus: () => true,
      // maxRedirects por defecto; el sitio responde 200 directo.
      headers: {
        'User-Agent': HTTP.userAgent,
        'Accept-Language': 'es-PE,es;q=0.9',
      },
    });
  }

  /** Cabecera Cookie serializada a partir de las cookies almacenadas. */
  get cookieHeader(): string {
    return Array.from(this.cookies.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  /** Guarda/actualiza cookies desde las cabeceras `Set-Cookie` de una respuesta. */
  private storeCookies(response: AxiosResponse): void {
    const setCookie = response.headers['set-cookie'];
    if (!setCookie) return;
    for (const raw of setCookie) {
      const [pair] = raw.split(';');
      const eq = pair.indexOf('=');
      if (eq === -1) continue;
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      if (name) this.cookies.set(name, value);
    }
  }

  /**
   * Calcula el tiempo de espera antes del siguiente intento.
   * Respeta la cabecera `Retry-After` si el servidor la provee (429/503);
   * en caso contrario aplica backoff exponencial con jitter.
   */
  private computeDelay(attempt: number, response?: AxiosResponse): number {
    const retryAfter = response?.headers?.['retry-after'];
    if (retryAfter) {
      const seconds = Number(retryAfter);
      if (!Number.isNaN(seconds) && seconds > 0) {
        return Math.min(seconds * 1000, RETRY.maxDelayMs);
      }
    }
    const exp = RETRY.baseDelayMs * Math.pow(RETRY.factor, attempt);
    const jitter = Math.floor(Math.random() * RETRY.jitterMs);
    return Math.min(exp, RETRY.maxDelayMs) + jitter;
  }

  /**
   * Ejecuta una request con reintentos automáticos.
   *
   * Reintenta ante:
   *  - Códigos HTTP en `RETRY.retryableStatuses` (429, 5xx).
   *  - Errores de red/timeout (sin respuesta).
   *
   * @throws {RequestFailedError} si se agotan los reintentos.
   */
  async request<T = unknown>(
    config: AxiosRequestConfig,
    label = 'request',
  ): Promise<AxiosResponse<T>> {
    let lastStatus: number | undefined;

    for (let attempt = 0; attempt <= RETRY.maxRetries; attempt++) {
      // Inyectar cookies de sesión en cada intento.
      const headers = {
        ...(config.headers ?? {}),
        ...(this.cookieHeader ? { Cookie: this.cookieHeader } : {}),
      };

      try {
        const response = await this.axios.request<T>({ ...config, headers });
        this.storeCookies(response);
        lastStatus = response.status;

        if (RETRY.retryableStatuses.includes(response.status)) {
          if (attempt < RETRY.maxRetries) {
            const delay = this.computeDelay(attempt, response);
            logger.warn(
              `${label}: HTTP ${response.status} (intento ${attempt + 1}/${
                RETRY.maxRetries + 1
              }). Reintentando en ${delay} ms…`,
            );
            await sleep(delay);
            continue;
          }
          // Sin más intentos disponibles.
          throw new RequestFailedError(
            `${label}: HTTP ${response.status} tras ${attempt + 1} intentos`,
            response.status,
            attempt + 1,
          );
        }

        // Cualquier otro código (incl. 2xx, 4xx no reintentables) se devuelve
        // al llamador para que decida.
        return response;
      } catch (err) {
        if (err instanceof RequestFailedError) throw err;

        // Error de red/timeout: reintentar si quedan intentos.
        const status = isAxiosError(err) ? err.response?.status : undefined;
        lastStatus = status;
        if (attempt < RETRY.maxRetries) {
          const delay = this.computeDelay(attempt, undefined);
          const reason = isAxiosError(err) ? err.code ?? err.message : String(err);
          logger.warn(
            `${label}: error de red (${reason}) (intento ${attempt + 1}/${
              RETRY.maxRetries + 1
            }). Reintentando en ${delay} ms…`,
          );
          await sleep(delay);
          continue;
        }
        throw new RequestFailedError(
          `${label}: error de red tras ${attempt + 1} intentos: ${String(err)}`,
          status,
          attempt + 1,
        );
      }
    }

    // Inalcanzable, pero satisface el control de flujo de TypeScript.
    throw new RequestFailedError(`${label}: agotados los reintentos`, lastStatus, RETRY.maxRetries + 1);
  }

  /** GET de conveniencia (HTML). */
  async get(url: string, label = 'GET'): Promise<AxiosResponse<string>> {
    return this.request<string>({ url, method: 'GET', responseType: 'text' }, label);
  }
}
