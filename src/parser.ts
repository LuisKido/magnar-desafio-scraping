/**
 * Parsers de las respuestas del sitio JSF/PrimeFaces.
 *
 * Dos formatos a interpretar:
 *  1. HTML completo (GET inicial): para extraer el `ViewState`.
 *  2. `partial-response` XML (respuestas AJAX de PrimeFaces): contiene bloques
 *     `<update>` con HTML dentro de secciones CDATA. De ahí extraemos la tabla
 *     de resultados, el total de registros y el `ViewState` renovado.
 */

import * as cheerio from 'cheerio';
import { DocumentRecord } from './types';

/** Extrae el valor de `javax.faces.ViewState` de un HTML completo. */
export function extractViewStateFromHtml(html: string): string | null {
  const $ = cheerio.load(html);
  const value = $('input[name="javax.faces.ViewState"]').attr('value');
  return value ?? null;
}

/**
 * Extrae el `ViewState` renovado de una respuesta AJAX `partial-response`.
 * PrimeFaces lo entrega como `<update id="...ViewState...">valor</update>`.
 */
export function extractViewStateFromPartial(xml: string): string | null {
  const match = xml.match(
    /<update id="[^"]*ViewState[^"]*"><!\[CDATA\[([\s\S]*?)\]\]><\/update>/,
  );
  return match ? match[1].trim() : null;
}

/**
 * Obtiene el HTML contenido en el bloque `<update id="...">` cuyo id contiene
 * `idFragment` (p. ej. el id del DataTable o del contenedor de la lista).
 */
export function extractUpdateHtml(xml: string, idFragment: string): string | null {
  // Se recorren todos los <update> y se elige el que matchea el fragmento.
  const re = /<update id="([^"]*)"><!\[CDATA\[([\s\S]*?)\]\]><\/update>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    if (m[1].includes(idFragment)) return m[2];
  }
  return null;
}

/**
 * Extrae el total de registros del texto del paginador de PrimeFaces,
 * con formato "Página X de Y (N registros)".
 */
export function extractTotalRecords(html: string): number | null {
  const match = html.match(/\((\d+)\s*registros?\)/i);
  return match ? Number(match[1]) : null;
}

/**
 * Parsea las filas de la DataTable.
 *
 * Maneja los dos formatos que emite PrimeFaces:
 *  - Búsqueda: tabla completa, con `<tbody id="...dt_data">` envolviendo filas.
 *  - Paginación: fragmento de `<tr data-ri="...">` sueltos (sin `<tbody>`).
 *
 * El nº global de fila (`nro`) proviene del atributo `data-ri` (0-basado),
 * que ya es global en todo el listado, por lo que no requiere offset.
 *
 * @param html       HTML de la tabla o fragmento de filas.
 * @param pagina     Nº de página, para etiquetar cada registro.
 * @param rowOffset  Nº global de la primera fila (fallback si falta `data-ri`).
 */
export function parseRows(
  html: string,
  pagina: number,
  rowOffset: number,
): DocumentRecord[] {
  // Los fragmentos de solo `<tr>` deben envolverse para que cheerio los parsee.
  const doc = /<tbody/i.test(html) ? html : `<table><tbody>${html}</tbody></table>`;
  const $ = cheerio.load(doc);
  const records: DocumentRecord[] = [];

  $('tr[data-ri]').each((idx, tr) => {
    const $tr = $(tr);

    // Filas de "sin resultados" no contienen datos útiles.
    if ($tr.hasClass('ui-datatable-empty-message')) return;

    const cells = $tr.find('> td');
    if (cells.length < 7) return;

    const text = (i: number): string =>
      cells.eq(i).text().replace(/\s+/g, ' ').trim();

    const dataRi = Number($tr.attr('data-ri'));
    const uuid = extractUuidFromRow($tr.html() ?? '');

    records.push({
      nro: Number.isFinite(dataRi) ? dataRi + 1 : rowOffset + idx + 1,
      numeroExpediente: text(1),
      administrado: text(2),
      unidadFiscalizable: text(3),
      sector: text(4),
      nroResolucion: text(5),
      uuid: uuid ?? '',
      pagina,
    });
  });

  return records;
}

/**
 * Extrae el `param_uuid` del `onclick` del enlace de descarga de una fila.
 * El enlace usa `mojarra.jsfcljs(form, {'...':'...','param_uuid':'<uuid>'}, '')`.
 */
export function extractUuidFromRow(rowHtml: string): string | null {
  const match = rowHtml.match(/param_uuid'\s*:\s*'([^']+)'/);
  return match ? match[1] : null;
}

/**
 * Extrae el nombre de archivo de una cabecera `Content-Disposition`.
 * Devuelve `null` si no está presente.
 */
export function parseContentDispositionFilename(header?: string): string | null {
  if (!header) return null;
  // filename*=UTF-8''... (RFC 5987) tiene prioridad si existe.
  const star = header.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
  if (star) {
    try {
      return decodeURIComponent(star[1].replace(/"/g, '').trim());
    } catch {
      /* cae al caso simple */
    }
  }
  const simple = header.match(/filename="?([^";]+)"?/i);
  return simple ? simple[1].trim() : null;
}
