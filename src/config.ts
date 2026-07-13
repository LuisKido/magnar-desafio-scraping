/**
 * Configuración centralizada del scraper.
 *
 * El objetivo por defecto es el Repositorio Digital de la OEFA (accesible sin
 * VPN). El sitio primario del desafío (Poder Judicial del Perú) requiere VPN a
 * Perú; su estructura JSF/PrimeFaces es equivalente, por lo que este mismo
 * scraper puede apuntarse a él ajustando `TARGET` y los nombres de campos.
 */

import * as path from 'path';

/** Descripción de un sitio JSF/PrimeFaces objetivo. */
export interface TargetConfig {
  /** Nombre legible del objetivo. */
  name: string;
  /** URL de la página de resultados (GET inicial y destino de los POST). */
  url: string;
  /** `id`/`name` del formulario JSF que contiene el buscador y la tabla. */
  formId: string;
  /** Cliente id del botón "Buscar". */
  searchButtonId: string;
  /** Cliente id del componente DataTable de resultados. */
  dataTableId: string;
  /** Componente(s) a renderizar tras la búsqueda (partial render). */
  searchRenderIds: string;
  /**
   * Campos del formulario que deben enviarse en cada POST (además de los de
   * infraestructura JSF). Se envían vacíos para "traer todo".
   */
  formFields: string[];
  /** Nº de filas por página que devuelve la tabla. */
  rowsPerPage: number;
}

/**
 * Objetivo OEFA — "Resoluciones del Tribunal de Fiscalización Ambiental".
 * Los ids `j_idtNN` fueron descubiertos inspeccionando el HTML del formulario.
 */
export const OEFA_TARGET: TargetConfig = {
  name: 'OEFA - Tribunal de Fiscalización Ambiental',
  url: 'https://publico.oefa.gob.pe/repdig/consulta/consultaTfa.xhtml',
  formId: 'listarDetalleInfraccionRAAForm',
  searchButtonId: 'listarDetalleInfraccionRAAForm:btnBuscar',
  dataTableId: 'listarDetalleInfraccionRAAForm:dt',
  searchRenderIds:
    'listarDetalleInfraccionRAAForm:pgLista listarDetalleInfraccionRAAForm:txtNroexp',
  formFields: [
    'listarDetalleInfraccionRAAForm:txtNroexp', // Número de expediente
    'listarDetalleInfraccionRAAForm:j_idt21', // Administrado
    'listarDetalleInfraccionRAAForm:j_idt25', // Unidad fiscalizable
    'listarDetalleInfraccionRAAForm:idsector', // Sector
    'listarDetalleInfraccionRAAForm:j_idt34', // Nro. Resolución de Apelación
  ],
  rowsPerPage: 10,
};

/** Objetivo activo. Cambiar aquí para apuntar a otro sitio JSF equivalente. */
export const TARGET: TargetConfig = OEFA_TARGET;

/** Rutas de salida. */
export const PATHS = {
  outputDir: path.resolve(process.cwd(), 'output'),
  pdfDir: path.resolve(process.cwd(), 'pdfs'),
  documentsJson: path.resolve(process.cwd(), 'output', 'documents.json'),
  documentsCsv: path.resolve(process.cwd(), 'output', 'documents.csv'),
  failuresJson: path.resolve(process.cwd(), 'output', 'failures.json'),
};

/** Parámetros de red y cortesía con el servidor. */
export const HTTP = {
  /** Timeout por request (ms). */
  timeoutMs: 60_000,
  /** User-Agent realista para evitar bloqueos triviales. */
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  /** Delay base entre requests (ms) para no saturar el servidor. */
  requestDelayMs: 700,
  /** Delay adicional entre descargas de PDF (ms). */
  downloadDelayMs: 1_200,
};

/** Configuración de reintentos con backoff exponencial (foco: HTTP 429). */
export const RETRY = {
  /** Máximo de intentos por descarga antes de darla por fallida. */
  maxRetries: 5,
  /** Delay base del backoff (ms). */
  baseDelayMs: 2_000,
  /** Factor multiplicativo del backoff exponencial. */
  factor: 2,
  /** Techo del delay (ms) para no esperar indefinidamente. */
  maxDelayMs: 60_000,
  /** Jitter aleatorio máximo (ms) sumado a cada espera. */
  jitterMs: 1_000,
  /** Códigos HTTP que disparan reintento. */
  retryableStatuses: [429, 500, 502, 503, 504],
};
