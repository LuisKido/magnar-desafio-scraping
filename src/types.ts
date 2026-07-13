/**
 * Tipos e interfaces compartidos por el scraper.
 */

/** Un registro (documento) extraído de la tabla de resultados. */
export interface DocumentRecord {
  /** Número de fila global dentro del listado completo (1..N). */
  nro: number;
  /** Número de expediente. */
  numeroExpediente: string;
  /** Administrado(s) sancionado(s). */
  administrado: string;
  /** Unidad fiscalizable. */
  unidadFiscalizable: string;
  /** Sector económico (Minería, Hidrocarburos, etc.). */
  sector: string;
  /** Número de la resolución de apelación (RTFA). */
  nroResolucion: string;
  /**
   * Identificador único del documento usado para descargar el PDF.
   * En el sitio de la OEFA corresponde al parámetro `param_uuid`.
   */
  uuid: string;
  /** Página (1-indexada) del listado en la que apareció el registro. */
  pagina: number;
}

/** Resultado de descargar un PDF. */
export interface DownloadResult {
  uuid: string;
  numeroExpediente: string;
  /** Ruta local donde se guardó el archivo (si tuvo éxito). */
  filePath?: string;
  /** Nombre de archivo final. */
  fileName?: string;
  success: boolean;
  /** Motivo del fallo, si aplica. */
  error?: string;
  /** Intentos realizados hasta el resultado final. */
  attempts: number;
}

/** Registro de un documento cuya descarga falló, para reintentar luego. */
export interface FailedDownload {
  uuid: string;
  numeroExpediente: string;
  nroResolucion: string;
  error: string;
  attempts: number;
  /** ISO timestamp del último intento. */
  lastAttempt: string;
}

/** Estado de la sesión JSF (cookie + ViewState vigente). */
export interface JsfSession {
  cookie: string;
  viewState: string;
}

/** Opciones de ejecución del scraper (parseadas de la línea de comandos). */
export interface ScraperOptions {
  /** Descargar los PDFs además de extraer metadatos. */
  downloadPdfs: boolean;
  /** Límite de páginas a recorrer (0 = todas). */
  maxPages: number;
  /** Límite de PDFs a descargar (0 = todos). Útil para pruebas. */
  maxDownloads: number;
  /** Solo reintentar las descargas registradas como fallidas. */
  retryFailed: boolean;
}
