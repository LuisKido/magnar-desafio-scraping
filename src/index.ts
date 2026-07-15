/**
 * Punto de entrada del scraper (CLI).
 *
 * Uso:
 *   npm run scrape                     Extrae metadatos y descarga todos los PDFs.
 *   npm run scrape -- --no-pdf         Solo extrae metadatos (sin descargar).
 *   npm run scrape -- --max-pages 3    Recorre solo las primeras 3 páginas.
 *   npm run scrape -- --max-downloads 5  Descarga solo 5 PDFs (prueba rápida).
 *   npm run retry                      Reintenta las descargas fallidas.
 */

import { Scraper } from './scraper';
import { TARGET } from './config';
import { logger } from './logger';
import { ScraperOptions } from './types';

/** Parsea `--flag value` y flags booleanas de process.argv. */
function parseArgs(argv: string[]): ScraperOptions {
  const opts: ScraperOptions = {
    downloadPdfs: true,
    maxPages: 0,
    maxDownloads: 0,
    retryFailed: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--no-pdf':
        opts.downloadPdfs = false;
        break;
      case '--retry-failed':
        opts.retryFailed = true;
        break;
      case '--max-pages':
        opts.maxPages = Number(argv[++i]) || 0;
        break;
      case '--max-downloads':
        opts.maxDownloads = Number(argv[++i]) || 0;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        if (arg.startsWith('--')) {
          logger.warn(`Argumento desconocido: ${arg}`);
        }
    }
  }
  return opts;
}

function printHelp(): void {
  // eslint-disable-next-line no-console
  console.log(`
Scraper OEFA/JSF — desafío de scraping

Objetivo actual: ${TARGET.name}
  ${TARGET.url}

Opciones:
  --no-pdf                Solo extraer metadatos (no descargar PDFs).
  --max-pages <n>         Limitar el nº de páginas a recorrer.
  --max-downloads <n>     Limitar el nº de PDFs a descargar (útil para pruebas).
  --retry-failed          Reintentar solo las descargas fallidas previas.
  -h, --help              Mostrar esta ayuda.

Scripts predefinidos (recomendado):
  npm run scrape          Todas las páginas + todos los PDFs.
  npm run scrape:test     1 página + 2 PDFs (prueba rápida).
  npm run scrape:sample   3 páginas + 5 PDFs.
  npm run scrape:meta     Solo metadatos (sin PDFs).
  npm run retry           Reintenta las descargas fallidas.

Con opciones personalizadas (portable, incl. Windows PowerShell):
  npx ts-node src/index.ts --max-pages 2 --max-downloads 5
  npx ts-node src/index.ts --no-pdf
`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  logger.info('===============================================');
  logger.info(' Scraper — Desafío de Scraping (TypeScript)');
  logger.info(` Objetivo: ${TARGET.name}`);
  logger.info('===============================================');

  const start = Date.now();
  const scraper = new Scraper(options);

  try {
    await scraper.run();
    const secs = ((Date.now() - start) / 1000).toFixed(1);
    logger.success(`Proceso completado en ${secs}s.`);
  } catch (err) {
    logger.error(`Error fatal: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

void main();
