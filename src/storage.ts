/**
 * Persistencia de resultados: metadatos (JSON/CSV), PDFs y registro de fallos.
 * Usa solo el módulo `fs` de Node para no añadir dependencias.
 */

import * as fs from 'fs';
import * as path from 'path';
import { PATHS } from './config';
import { DocumentRecord, FailedDownload } from './types';

/** Crea los directorios de salida si no existen. */
export function ensureDirs(): void {
  for (const dir of [PATHS.outputDir, PATHS.pdfDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Guarda los metadatos extraídos en JSON. */
export function saveDocumentsJson(records: DocumentRecord[]): void {
  fs.writeFileSync(PATHS.documentsJson, JSON.stringify(records, null, 2), 'utf-8');
}

/** Escapa un valor para CSV (comillas y separadores). */
function csvCell(value: string | number): string {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Guarda los metadatos extraídos en CSV (con BOM para Excel). */
export function saveDocumentsCsv(records: DocumentRecord[]): void {
  const headers = [
    'nro',
    'numeroExpediente',
    'administrado',
    'unidadFiscalizable',
    'sector',
    'nroResolucion',
    'uuid',
    'pagina',
  ];
  const lines = [headers.join(',')];
  for (const r of records) {
    lines.push(
      [
        r.nro,
        r.numeroExpediente,
        r.administrado,
        r.unidadFiscalizable,
        r.sector,
        r.nroResolucion,
        r.uuid,
        r.pagina,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  // BOM UTF-8 para que Excel muestre bien las tildes.
  fs.writeFileSync(PATHS.documentsCsv, '﻿' + lines.join('\r\n'), 'utf-8');
}

/** Carga los metadatos previamente guardados (para reintentos/descarga). */
export function loadDocumentsJson(): DocumentRecord[] {
  if (!fs.existsSync(PATHS.documentsJson)) return [];
  return JSON.parse(fs.readFileSync(PATHS.documentsJson, 'utf-8')) as DocumentRecord[];
}

/** Persiste el listado de descargas fallidas. */
export function saveFailures(failures: FailedDownload[]): void {
  fs.writeFileSync(PATHS.failuresJson, JSON.stringify(failures, null, 2), 'utf-8');
}

/** Carga el listado de descargas fallidas (para `--retry-failed`). */
export function loadFailures(): FailedDownload[] {
  if (!fs.existsSync(PATHS.failuresJson)) return [];
  return JSON.parse(fs.readFileSync(PATHS.failuresJson, 'utf-8')) as FailedDownload[];
}

/**
 * Construye un nombre de archivo descriptivo y seguro para el PDF.
 * Combina el nº de resolución (o expediente) con el uuid corto para evitar
 * colisiones, y descarta caracteres inválidos en sistemas de archivos.
 */
export function buildPdfFileName(record: DocumentRecord, suggested: string | null): string {
  const base =
    record.nroResolucion?.trim() ||
    record.numeroExpediente?.trim() ||
    suggested?.replace(/\.pdf$/i, '') ||
    record.uuid;

  const safe = base
    .replace(/[\\/:*?"<>|]+/g, '-') // caracteres inválidos en Windows
    .replace(/\s+/g, '_')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 120);

  const shortUuid = record.uuid.slice(0, 8);
  return `${safe || 'documento'}__${shortUuid}.pdf`;
}

/** Escribe un PDF en el directorio de salida y devuelve su ruta. */
export function savePdf(fileName: string, data: Buffer): string {
  const filePath = path.join(PATHS.pdfDir, fileName);
  fs.writeFileSync(filePath, data);
  return filePath;
}

/** Indica si ya existe un PDF con ese nombre (para reanudar sin re-descargar). */
export function pdfExists(fileName: string): boolean {
  return fs.existsSync(path.join(PATHS.pdfDir, fileName));
}
