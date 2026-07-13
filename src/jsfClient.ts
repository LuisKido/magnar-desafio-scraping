/**
 * Cliente de alto nivel para el sitio JSF/PrimeFaces objetivo.
 *
 * Encapsula el "protocolo" descubierto por ingeniería inversa:
 *
 *   1. init()        GET inicial  -> cookie JSESSIONID + ViewState.
 *   2. search()      POST AJAX (botón "Buscar") -> primera página + total de
 *                    registros. Deja la tabla poblada en el estado del servidor
 *                    (necesario para que las descargas resuelvan).
 *   3. fetchPage(n)  POST AJAX de paginación de la DataTable (offset dt_first).
 *   4. downloadPdf() POST "mojarra.jsfcljs" (postback no-AJAX) con `param_uuid`
 *                    -> binario PDF. El uuid identifica el documento de forma
 *                    global, por lo que no hace falta navegar a su página.
 *
 * Detalles clave de robustez:
 *   - El `ViewState` se renueva en cada respuesta AJAX y debe reutilizarse.
 *   - El encoding de las respuestas es inconsistente (UTF-8 y latin1 según el
 *     endpoint); se decodifica con autodetección (ver `decodeBody`).
 *   - El trigger de descarga `dt:0:j_idt63` solo resuelve si la tabla está en
 *     su primera página; por eso las descargas se hacen tras volver a ella.
 */

import { AxiosResponse } from 'axios';
import { TARGET, HTTP } from './config';
import { HttpClient } from './httpClient';
import { logger } from './logger';
import {
  extractViewStateFromHtml,
  extractViewStateFromPartial,
  extractUpdateHtml,
  extractTotalRecords,
  parseRows,
  parseContentDispositionFilename,
} from './parser';
import { DocumentRecord } from './types';

/** Cabeceras comunes para las peticiones AJAX parciales de PrimeFaces. */
const AJAX_HEADERS = {
  'Faces-Request': 'partial/ajax',
  'X-Requested-With': 'XMLHttpRequest',
  'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
  Accept: 'application/xml, text/xml, */*; q=0.01',
};

export class JsfClient {
  private readonly http = new HttpClient();
  private viewState = '';

  /**
   * Decodifica el cuerpo de una respuesta binaria de forma robusta.
   *
   * El sitio es inconsistente: algunas respuestas vienen en UTF-8 y otras en
   * latin1 (ISO-8859-1). Se intenta UTF-8 primero; si aparece el carácter de
   * reemplazo U+FFFD (byte inválido para UTF-8), se reinterpreta como latin1.
   */
  private static decodeBody(data: ArrayBuffer | Buffer): string {
    const buf = Buffer.from(data as Buffer);
    const utf8 = buf.toString('utf-8');
    return utf8.includes('�') ? buf.toString('latin1') : utf8;
  }

  /** Serializa un objeto a `application/x-www-form-urlencoded`. */
  private static encodeForm(fields: Record<string, string>): string {
    return Object.entries(fields)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
  }

  /** Devuelve los campos vacíos del formulario de búsqueda. */
  private emptyFormFields(): Record<string, string> {
    const fields: Record<string, string> = {
      [TARGET.formId]: TARGET.formId,
    };
    for (const f of TARGET.formFields) fields[f] = '';
    return fields;
  }

  /**
   * Paso 1: obtiene la página inicial y captura cookie + ViewState.
   * Debe llamarse antes que cualquier otra operación.
   */
  async init(): Promise<void> {
    logger.info(`Inicializando sesión en ${TARGET.url}`);
    const res = await this.http.get(TARGET.url, 'GET inicial');
    if (res.status !== 200) {
      throw new Error(`GET inicial devolvió HTTP ${res.status}`);
    }
    const vs = extractViewStateFromHtml(res.data);
    if (!vs) throw new Error('No se encontró ViewState en la página inicial');
    this.viewState = vs;
    logger.success('Sesión inicializada (cookie + ViewState obtenidos)');
  }

  /**
   * Paso 2: ejecuta la búsqueda "traer todo" (campos vacíos).
   * @returns registros de la primera página y el total de registros.
   */
  async search(): Promise<{ firstPage: DocumentRecord[]; totalRecords: number }> {
    logger.info('Ejecutando búsqueda (Buscar) para poblar resultados…');
    const body = JsfClient.encodeForm({
      'javax.faces.partial.ajax': 'true',
      'javax.faces.source': TARGET.searchButtonId,
      'javax.faces.partial.execute': TARGET.searchButtonId,
      'javax.faces.partial.render': TARGET.searchRenderIds,
      [TARGET.searchButtonId]: TARGET.searchButtonId,
      ...this.emptyFormFields(),
      'javax.faces.ViewState': this.viewState,
    });

    const res = await this.postAjax(body, 'Búsqueda');
    const xml = JsfClient.decodeBody(res.data);
    this.refreshViewState(xml);

    const tableHtml = extractUpdateHtml(xml, TARGET.dataTableId) ?? xml;
    const total = extractTotalRecords(tableHtml) ?? 0;
    const firstPage = parseRows(tableHtml, 1, 0);

    logger.success(
      `Búsqueda completada: ${total} registros en total ` +
        `(${firstPage.length} en la primera página).`,
    );
    return { firstPage, totalRecords: total };
  }

  /**
   * Paso 3: obtiene una página arbitraria de la DataTable vía paginación AJAX.
   * @param pageIndex Índice de página 0-basado.
   */
  async fetchPage(pageIndex: number): Promise<DocumentRecord[]> {
    const first = pageIndex * TARGET.rowsPerPage;
    const body = JsfClient.encodeForm({
      'javax.faces.partial.ajax': 'true',
      'javax.faces.source': TARGET.dataTableId,
      'javax.faces.partial.execute': TARGET.dataTableId,
      'javax.faces.partial.render': TARGET.dataTableId,
      [TARGET.dataTableId]: TARGET.dataTableId,
      [`${TARGET.dataTableId}_pagination`]: 'true',
      [`${TARGET.dataTableId}_first`]: String(first),
      [`${TARGET.dataTableId}_rows`]: String(TARGET.rowsPerPage),
      [`${TARGET.dataTableId}_encodeFeature`]: 'true',
      [TARGET.formId]: TARGET.formId,
      'javax.faces.ViewState': this.viewState,
    });

    const res = await this.postAjax(body, `Página ${pageIndex + 1}`);
    const xml = JsfClient.decodeBody(res.data);
    this.refreshViewState(xml);

    const tableHtml = extractUpdateHtml(xml, TARGET.dataTableId) ?? xml;
    return parseRows(tableHtml, pageIndex + 1, first);
  }

  /**
   * Devuelve la DataTable a su primera página. Es necesario antes de descargar,
   * porque el trigger `dt:0:j_idt63` solo resuelve cuando la fila de índice 0
   * está renderizada (es decir, en la primera página).
   */
  async gotoFirstPage(): Promise<void> {
    await this.fetchPage(0);
  }

  /**
   * Paso 4: descarga el PDF de un documento por su `uuid`.
   *
   * Usa un postback no-AJAX equivalente a `mojarra.jsfcljs`. El trigger
   * `dt:0:j_idt63` basta porque el documento se identifica por `param_uuid`.
   *
   * @returns el binario del PDF y el nombre sugerido por el servidor.
   * @throws si el servidor no devuelve un PDF (p. ej. sesión expirada).
   */
  async downloadPdf(
    uuid: string,
  ): Promise<{ data: Buffer; suggestedName: string | null; contentType: string }> {
    const commandId = `${TARGET.dataTableId}:0:j_idt63`;
    const body = JsfClient.encodeForm({
      ...this.emptyFormFields(),
      [commandId]: commandId,
      param_uuid: uuid,
      'javax.faces.ViewState': this.viewState,
    });

    const res = await this.http.request<ArrayBuffer>(
      {
        url: TARGET.url,
        method: 'POST',
        data: body,
        responseType: 'arraybuffer',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/pdf,application/octet-stream,*/*',
        },
      },
      `Descarga ${uuid.slice(0, 8)}`,
    );

    const contentType = String(res.headers['content-type'] ?? '');
    const data = Buffer.from(res.data);

    // Si el servidor devolvió HTML/XML en lugar de un binario, la sesión
    // probablemente expiró o el uuid no resolvió: se trata como error.
    if (!contentType.includes('octet-stream') && !contentType.includes('pdf')) {
      // Reintentar re-armando la sesión una vez es responsabilidad del
      // orquestador; aquí solo señalamos el problema.
      throw new Error(
        `Respuesta no-PDF (Content-Type: ${contentType || 'desconocido'})`,
      );
    }

    const disposition = String(res.headers['content-disposition'] ?? '');
    const suggestedName = parseContentDispositionFilename(disposition);

    return { data, suggestedName, contentType };
  }

  /** Ejecuta un POST AJAX y devuelve la respuesta (binaria para decodificar). */
  private async postAjax(body: string, label: string): Promise<AxiosResponse<ArrayBuffer>> {
    return this.http.request<ArrayBuffer>(
      {
        url: TARGET.url,
        method: 'POST',
        data: body,
        responseType: 'arraybuffer',
        headers: AJAX_HEADERS,
      },
      label,
    );
  }

  /** Actualiza el ViewState a partir de una respuesta parcial, si viene uno. */
  private refreshViewState(xml: string): void {
    const vs = extractViewStateFromPartial(xml);
    if (vs) this.viewState = vs;
  }

  /** Delay de cortesía entre requests de navegación. */
  get requestDelayMs(): number {
    return HTTP.requestDelayMs;
  }

  /** Reinicia la sesión (para recuperarse de una sesión expirada). */
  async reset(): Promise<void> {
    await this.init();
    await this.search();
  }
}
