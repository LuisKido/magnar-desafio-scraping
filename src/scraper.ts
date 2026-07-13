/**
 * Orquestador del scraping. Coordina el cliente JSF, la persistencia y el
 * manejo de errores en dos fases:
 *
 *   Fase 1 — Crawl:    recorre todas las páginas y extrae los metadatos.
 *   Fase 2 — Descarga: descarga los PDFs (opcional), con backoff ante 429 y
 *                      registro de fallos para reintentar después.
 */

import { TARGET, HTTP, RETRY } from './config';
import { JsfClient } from './jsfClient';
import { RequestFailedError } from './httpClient';
import { logger, sleep } from './logger';
import {
  DocumentRecord,
  FailedDownload,
  ScraperOptions,
  DownloadResult,
} from './types';
import {
  ensureDirs,
  saveDocumentsJson,
  saveDocumentsCsv,
  saveFailures,
  loadDocumentsJson,
  loadFailures,
  buildPdfFileName,
  savePdf,
  pdfExists,
} from './storage';

export class Scraper {
  private readonly client = new JsfClient();

  constructor(private readonly options: ScraperOptions) {}

  /** Punto de entrada principal. */
  async run(): Promise<void> {
    ensureDirs();

    if (this.options.retryFailed) {
      await this.runRetryFailed();
      return;
    }

    // Fase 1: crawl de metadatos.
    const records = await this.crawl();
    saveDocumentsJson(records);
    saveDocumentsCsv(records);
    logger.success(
      `Metadatos guardados: ${records.length} documentos en output/documents.json y .csv`,
    );

    // Fase 2: descarga de PDFs (opcional).
    if (this.options.downloadPdfs) {
      await this.downloadAll(records);
    } else {
      logger.info('Descarga de PDFs omitida (--no-pdf).');
    }
  }

  /**
   * Fase 1: navega por todas las páginas de la tabla y acumula los registros.
   * Ya tiene la primera página de la búsqueda; el resto se pide por AJAX.
   */
  private async crawl(): Promise<DocumentRecord[]> {
    await this.client.init();
    const { firstPage, totalRecords } = await this.client.search();

    const totalPages = Math.ceil(totalRecords / TARGET.rowsPerPage);
    const pagesToVisit =
      this.options.maxPages > 0
        ? Math.min(this.options.maxPages, totalPages)
        : totalPages;

    logger.info(
      `Total: ${totalRecords} registros, ${totalPages} páginas. ` +
        `Se recorrerán ${pagesToVisit} página(s).`,
    );

    const records: DocumentRecord[] = [...firstPage];

    // La página 1 (índice 0) ya la tenemos de la búsqueda.
    for (let page = 1; page < pagesToVisit; page++) {
      await sleep(HTTP.requestDelayMs);
      try {
        const rows = await this.client.fetchPage(page);
        records.push(...rows);
        logger.info(
          `Página ${page + 1}/${pagesToVisit}: ${rows.length} filas ` +
            `(acumulado: ${records.length}).`,
        );
      } catch (err) {
        logger.error(
          `Fallo al obtener la página ${page + 1}: ${(err as Error).message}. ` +
            'Se continúa con la siguiente.',
        );
      }
    }

    // Filtra registros sin uuid (no descargables) pero los conserva en metadatos.
    const sinUuid = records.filter((r) => !r.uuid).length;
    if (sinUuid > 0) {
      logger.warn(`${sinUuid} registro(s) sin uuid de descarga.`);
    }

    return records;
  }

  /**
   * Fase 2: descarga los PDFs de todos los registros con uuid.
   * Aplica delay de cortesía, maneja 429 vía el HttpClient y registra fallos.
   */
  private async downloadAll(records: DocumentRecord[]): Promise<void> {
    const descargables = records.filter((r) => r.uuid);
    const limit =
      this.options.maxDownloads > 0
        ? Math.min(this.options.maxDownloads, descargables.length)
        : descargables.length;

    logger.info(`Iniciando descarga de ${limit} PDF(s)…`);

    // El crawl dejó la tabla en la última página; el trigger de descarga
    // (`dt:0`) requiere estar en la primera. Volvemos a ella una sola vez.
    try {
      await this.client.gotoFirstPage();
    } catch (err) {
      logger.warn(
        `No se pudo volver a la primera página (${(err as Error).message}); ` +
          'se reinicia la sesión.',
      );
      await this.client.reset();
    }

    const failures: FailedDownload[] = [];
    let ok = 0;
    let skipped = 0;

    for (let i = 0; i < limit; i++) {
      const record = descargables[i];
      const result = await this.downloadOne(record);

      if (result.success) {
        if (result.error === 'skipped') {
          skipped++;
        } else {
          ok++;
          logger.success(
            `[${i + 1}/${limit}] ${result.fileName} ` +
              `(${(result as DownloadResult).attempts} intento/s)`,
          );
        }
      } else {
        failures.push({
          uuid: record.uuid,
          numeroExpediente: record.numeroExpediente,
          nroResolucion: record.nroResolucion,
          error: result.error ?? 'desconocido',
          attempts: result.attempts,
          lastAttempt: new Date().toISOString(),
        });
        logger.error(
          `[${i + 1}/${limit}] Falló ${record.nroResolucion || record.uuid}: ${result.error}`,
        );
        // Persistimos los fallos de forma incremental por si se interrumpe.
        saveFailures(failures);
      }

      await sleep(HTTP.downloadDelayMs);
    }

    saveFailures(failures);
    logger.success(
      `Descarga finalizada. OK: ${ok}, ya existentes: ${skipped}, ` +
        `fallidos: ${failures.length}.`,
    );
    if (failures.length > 0) {
      logger.warn(
        `Fallos registrados en output/failures.json. ` +
          `Reintentar con: npm run retry`,
      );
    }
  }

  /**
   * Descarga un único documento. Reintenta re-armando la sesión una vez si el
   * servidor devuelve algo que no es un PDF (típico de sesión expirada).
   */
  private async downloadOne(record: DocumentRecord): Promise<DownloadResult> {
    // Reanudación: si el PDF ya existe, no se vuelve a descargar.
    const tentativeName = buildPdfFileName(record, null);
    if (pdfExists(tentativeName)) {
      return {
        uuid: record.uuid,
        numeroExpediente: record.numeroExpediente,
        fileName: tentativeName,
        success: true,
        error: 'skipped',
        attempts: 0,
      };
    }

    for (let sessionAttempt = 0; sessionAttempt < 2; sessionAttempt++) {
      try {
        const { data, suggestedName } = await this.client.downloadPdf(record.uuid);
        const fileName = buildPdfFileName(record, suggestedName);
        const filePath = savePdf(fileName, data);
        return {
          uuid: record.uuid,
          numeroExpediente: record.numeroExpediente,
          fileName,
          filePath,
          success: true,
          attempts: 1,
        };
      } catch (err) {
        const isNonPdf = err instanceof Error && err.message.includes('no-PDF');
        // Si la sesión pudo expirar, se re-inicializa una vez y se reintenta.
        if (isNonPdf && sessionAttempt === 0) {
          logger.warn('Posible sesión expirada; reinicializando sesión…');
          try {
            await this.client.reset();
            continue;
          } catch (resetErr) {
            return this.toFailure(record, resetErr);
          }
        }
        return this.toFailure(record, err);
      }
    }

    return this.toFailure(record, new Error('agotados los intentos de sesión'));
  }

  private toFailure(record: DocumentRecord, err: unknown): DownloadResult {
    const attempts =
      err instanceof RequestFailedError ? err.attempts : RETRY.maxRetries + 1;
    return {
      uuid: record.uuid,
      numeroExpediente: record.numeroExpediente,
      success: false,
      error: err instanceof Error ? err.message : String(err),
      attempts,
    };
  }

  /**
   * Modo `--retry-failed`: reintenta únicamente las descargas registradas como
   * fallidas en output/failures.json. Requiere metadatos previos.
   */
  private async runRetryFailed(): Promise<void> {
    const failures = loadFailures();
    if (failures.length === 0) {
      logger.info('No hay descargas fallidas para reintentar.');
      return;
    }

    const allRecords = loadDocumentsJson();
    const byUuid = new Map(allRecords.map((r) => [r.uuid, r]));

    logger.info(`Reintentando ${failures.length} descarga(s) fallida(s)…`);
    await this.client.init();
    await this.client.search(); // deja la tabla poblada en el servidor

    const stillFailing: FailedDownload[] = [];
    let recovered = 0;

    for (let i = 0; i < failures.length; i++) {
      const f = failures[i];
      const record: DocumentRecord =
        byUuid.get(f.uuid) ??
        ({
          nro: 0,
          numeroExpediente: f.numeroExpediente,
          administrado: '',
          unidadFiscalizable: '',
          sector: '',
          nroResolucion: f.nroResolucion,
          uuid: f.uuid,
          pagina: 0,
        } as DocumentRecord);

      const result = await this.downloadOne(record);
      if (result.success) {
        recovered++;
        logger.success(`[${i + 1}/${failures.length}] Recuperado ${result.fileName}`);
      } else {
        stillFailing.push({
          ...f,
          error: result.error ?? f.error,
          attempts: f.attempts + result.attempts,
          lastAttempt: new Date().toISOString(),
        });
        logger.error(`[${i + 1}/${failures.length}] Sigue fallando: ${result.error}`);
      }
      await sleep(HTTP.downloadDelayMs);
    }

    saveFailures(stillFailing);
    logger.success(
      `Reintento finalizado. Recuperados: ${recovered}, aún fallidos: ${stillFailing.length}.`,
    );
  }
}
