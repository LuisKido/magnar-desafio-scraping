/**
 * Logger minimalista con niveles y marca de tiempo.
 * Evita dependencias externas manteniendo salida legible en consola.
 */

/* eslint-disable no-console */

function ts(): string {
  return new Date().toISOString().replace('T', ' ').replace('Z', '');
}

export const logger = {
  info(message: string, ...rest: unknown[]): void {
    console.log(`[${ts()}] INFO  ${message}`, ...rest);
  },
  warn(message: string, ...rest: unknown[]): void {
    console.warn(`[${ts()}] WARN  ${message}`, ...rest);
  },
  error(message: string, ...rest: unknown[]): void {
    console.error(`[${ts()}] ERROR ${message}`, ...rest);
  },
  success(message: string, ...rest: unknown[]): void {
    console.log(`[${ts()}] OK    ${message}`, ...rest);
  },
};

/** Pausa la ejecución `ms` milisegundos. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
