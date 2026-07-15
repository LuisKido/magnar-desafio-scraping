# Scraper Challenge — Repositorio Digital OEFA (TypeScript)

Scraper en **TypeScript** que navega, extrae y descarga documentos de un sitio
**JSF / PrimeFaces**, usando únicamente **peticiones HTTP** (`axios`) y
**parsing HTML** (`cheerio`). **Sin automatización de navegador** (no usa
Puppeteer, Playwright ni Selenium).

> ### ℹ️ Sobre el sitio elegido (léase primero)
>
> El enunciado propone **dos sitios** para resolver el desafío:
>
> - **Primario** — Jurisprudencia del **Poder Judicial del Perú**. El propio
>   enunciado indica: *"requiere VPN a Perú"*.
> - **Alternativo** — Repositorio Digital de la **OEFA**. El enunciado lo
>   describe textualmente como: *"Sitio web alternativo (opcional, sin VPN) …
>   Este sitio es opcional y puede usarse para desarrollo/pruebas sin necesidad
>   de VPN."*
>
> **Este scraper resuelve el desafío sobre el sitio de la OEFA**, porque es el
> objetivo **públicamente accesible sin VPN** y, por tanto, **verificable de
> forma reproducible por quien evalúe** (basta `npm install && npm run scrape`,
> sin infraestructura adicional).
>
> Ambos sitios están construidos con la **misma tecnología** (JSF + PrimeFaces)
> y comparten el mismo patrón de navegación, paginación y descarga. Por eso el
> scraper está diseñado para ser **reapuntable**: toda la parte específica del
> sitio (URL e identificadores JSF) está aislada en un único objeto de
> configuración `TargetConfig` en [`src/config.ts`](src/config.ts). Migrar al
> sitio del Poder Judicial (con VPN) consiste en **crear un nuevo `TargetConfig`**
> con sus ids; la lógica de sesión, `ViewState`, paginación, descarga y manejo de
> 429 se reutiliza **sin cambios**. Ver la sección
> [Apuntar a otro sitio JSF](#apuntar-a-otro-sitio-jsf-p-ej-poder-judicial).

## Objetivo

| Sitio | URL | Acceso | En este repo |
|-------|-----|--------|--------------|
| **Poder Judicial del Perú** (primario) | `https://jurisprudencia.pj.gob.pe/jurisprudenciaweb/faces/page/resultado.xhtml` | Requiere **VPN a Perú** | Soportado por configuración (no verificable sin VPN) |
| **OEFA — Tribunal de Fiscalización Ambiental** (alternativo, elegido) | `https://publico.oefa.gob.pe/repdig/consulta/consultaTfa.xhtml` | **Público, sin VPN** | ✅ Implementado y probado end-to-end |

> El sitio de la OEFA publica **1 753 resoluciones** del Tribunal de
> Fiscalización Ambiental repartidas en **176 páginas** (10 por página).

## Cómo funciona (estructura descubierta)

El sitio es una aplicación **JSF (Mojarra) con PrimeFaces 6.0**. No hay una API
REST ni URLs directas a los PDFs; todo ocurre mediante *postbacks* con estado de
servidor (`ViewState`). El flujo que reproduce el scraper es:

1. **`GET` inicial** → obtiene la cookie de sesión `JSESSIONID` y el token
   `javax.faces.ViewState`.
2. **Búsqueda ("Buscar")** → `POST` AJAX de PrimeFaces con los filtros vacíos
   ("traer todo"). Devuelve la primera página de resultados y el total de
   registros, y deja la tabla poblada en el estado del servidor.
3. **Paginación** → `POST` AJAX de la *DataTable* con el offset `dt_first`
   (0, 10, 20, …) para recorrer las 176 páginas.
4. **Descarga de PDF** → `POST` no-AJAX equivalente a `mojarra.jsfcljs`, con el
   parámetro **`param_uuid`** (identificador único del documento). El servidor
   responde el binario del PDF con su nombre en la cabecera
   `Content-Disposition`.

Cada fila de la tabla aporta: **Nº**, **Número de expediente**, **Administrado**,
**Unidad fiscalizable**, **Sector**, **Nº de Resolución de Apelación** y el
**`uuid`** necesario para descargar su PDF.

### Detalles no triviales resueltos

- **`ViewState` rotativo**: JSF renueva el token en cada respuesta AJAX. El
  scraper lo extrae de cada `partial-response` y lo reutiliza; ignorarlo rompe
  las peticiones siguientes.
- **Encoding inconsistente**: unas respuestas llegan en UTF-8 y otras en latin1.
  Se decodifica con autodetección para conservar tildes y la `ñ`
  (`decodeBody` en [`src/jsfClient.ts`](src/jsfClient.ts)).
- **Trigger de descarga**: el `param_uuid` identifica el documento de forma
  global, pero el componente que dispara la descarga (`dt:0:j_idt63`) solo
  resuelve si la tabla está en su **primera página**; el scraper vuelve a ella
  antes de descargar.

## Requisitos

- **Node.js ≥ 18** (probado con Node 22).
- npm.

## Instalación

```bash
git clone https://github.com/LuisKido/magnar-desafio-scraping.git
cd magnar-desafio-scraping
npm install
```

## Uso

### Scripts predefinidos (recomendado — funcionan en cualquier terminal)

```bash
npm run scrape          # TODAS las páginas + descarga TODOS los PDFs
npm run scrape:test     # Prueba rápida: 1 página (10 registros) + 2 PDFs
npm run scrape:sample   # 3 páginas (30 registros) + 5 PDFs
npm run scrape:meta     # Solo metadatos, sin descargar PDFs
npm run retry           # Reintenta solo las descargas fallidas (failures.json)
```

### Con opciones personalizadas

Para pasar opciones propias (p. ej. otros límites), invoca el script
directamente con `npx`. **Esta forma funciona igual en Windows PowerShell,
CMD, macOS y Linux:**

```bash
npx ts-node src/index.ts --max-pages 3 --max-downloads 5
npx ts-node src/index.ts --no-pdf
npx ts-node src/index.ts --help
```

> ⚠️ **Nota (Windows PowerShell)**: evita la forma `npm run scrape -- --max-pages 3`.
> En PowerShell, npm no reenvía correctamente los argumentos que van tras `--`
> (los interpreta como configuración propia y no llegan al script). Usa los
> **scripts predefinidos** de arriba o la forma **`npx ts-node …`**, que no
> tienen ese problema. En Bash/CMD la forma `npm run scrape -- <args>` sí
> funciona, pero `npx ts-node …` es la más portable.

### Opciones de línea de comandos

| Opción | Descripción |
|--------|-------------|
| `--no-pdf` | Solo extrae metadatos (no descarga PDFs). |
| `--max-pages <n>` | Limita el nº de páginas a recorrer. |
| `--max-downloads <n>` | Limita el nº de PDFs a descargar (ideal para pruebas). |
| `--retry-failed` | Reintenta solo las descargas registradas como fallidas. |
| `-h`, `--help` | Muestra la ayuda. |

### Compilar a JavaScript (opcional)

```bash
npm run build   # genera dist/
node dist/index.js --max-pages 2
```

## Salida

```
magnar-desafio-scraping/
├── output/
│   ├── documents.json   # metadatos de todos los documentos (estructurado)
│   ├── documents.csv    # los mismos datos en CSV (BOM UTF-8, abre en Excel)
│   └── failures.json    # descargas fallidas, para reintentar con `npm run retry`
└── pdfs/
    └── <NºResolución>__<uuid8>.pdf   # un archivo por documento
```

Ejemplo de un registro en `documents.json`:

```json
{
  "nro": 1,
  "numeroExpediente": "891-08-PRODUCE/DIGSECOVI-Dsvs",
  "administrado": "Corporación del Mar S.A. Austral Group S.A.A.",
  "unidadFiscalizable": "Planta Playa Lado Norte Puerto Malabrigo",
  "sector": "Pesquería",
  "nroResolucion": "264-2012-OEFA/TFA",
  "uuid": "153a6d2a-cbed-40ef-b8ef-cd2272b19867",
  "pagina": 1
}
```

Los PDFs se nombran con el **nº de resolución** más los primeros 8 caracteres del
`uuid` (para evitar colisiones y caracteres inválidos en el sistema de archivos),
p. ej. `264-2012-OEFA-TFA__153a6d2a.pdf`.

## Manejo de errores 429 (Too Many Requests) y robustez

El desafío pone el foco en el rate limiting. La estrategia implementada
(ver [`src/httpClient.ts`](src/httpClient.ts)) es:

- **Detección de 429** (y de errores transitorios 5xx y de red/timeout).
- **Backoff exponencial con jitter**: la espera crece como
  `base × factor^intento` (2s, 4s, 8s, …) con un tope y un componente aleatorio
  para evitar sincronización de reintentos. Si el servidor envía la cabecera
  `Retry-After`, se respeta.
- **Reintentos configurables** (`maxRetries`, por defecto 5) por descarga.
- **Continuación**: si una descarga sigue fallando tras agotar los reintentos,
  se **registra en `output/failures.json`** y el scraper **continúa** con el
  siguiente documento.
- **Reintento posterior**: `npm run retry` reprocesa solo los documentos
  fallidos.

Otras medidas de robustez:

- **Delays de cortesía** entre peticiones y entre descargas para no saturar el
  servidor (configurables en [`src/config.ts`](src/config.ts)).
- **Reanudable**: si un PDF ya existe en `pdfs/`, no se vuelve a descargar, por
  lo que se puede detener y relanzar sin perder progreso.
- **Recuperación de sesión**: si una descarga devuelve HTML en lugar de un PDF
  (sesión expirada), el scraper reinicializa la sesión y reintenta una vez.
- **Guardado incremental** del registro de fallos ante interrupciones.

Toda la configuración (delays, reintentos, backoff, objetivo) está centralizada
en [`src/config.ts`](src/config.ts).

## Estructura del código

```
src/
├── index.ts        # CLI: parseo de argumentos y arranque
├── config.ts       # configuración: objetivo, rutas, red, reintentos
├── types.ts        # interfaces (DocumentRecord, FailedDownload, ...)
├── logger.ts       # logger con niveles + utilidad sleep
├── httpClient.ts   # axios + cookies de sesión + retry/backoff (429)
├── jsfClient.ts    # protocolo JSF/PrimeFaces (init, search, paginate, download)
├── parser.ts       # parsing con cheerio (ViewState, filas, uuid, paginador)
├── scraper.ts      # orquestación en 2 fases (crawl + descarga) y fallos
└── storage.ts      # persistencia (JSON, CSV, PDFs, failures)
```

## Apuntar a otro sitio JSF (p. ej. Poder Judicial)

Toda la parte específica del sitio está aislada en un objeto `TargetConfig` en
[`src/config.ts`](src/config.ts). Para apuntar a otro sitio JSF/PrimeFaces
(como el del **Poder Judicial del Perú**, que requiere VPN a Perú) basta con
declarar un nuevo objetivo y asignarlo a `TARGET`:

```ts
export const PODER_JUDICIAL_TARGET: TargetConfig = {
  name: 'Poder Judicial del Perú - Jurisprudencia',
  url: 'https://jurisprudencia.pj.gob.pe/jurisprudenciaweb/faces/page/resultado.xhtml',
  formId: '...',            // id/name del <form> JSF
  searchButtonId: '...',    // clientId del botón "Buscar"
  dataTableId: '...',       // clientId de la <p:dataTable> de resultados
  searchRenderIds: '...',   // componentes a renderizar tras buscar
  formFields: ['...'],      // campos del formulario (se envían vacíos)
  rowsPerPage: 10,          // filas por página que devuelve la tabla
};

// Cambiar el objetivo activo:
export const TARGET: TargetConfig = PODER_JUDICIAL_TARGET;
```

Los identificadores (`formId`, `searchButtonId`, `dataTableId`, `formFields`,
etc.) se obtienen **inspeccionando el HTML** del formulario del sitio, tal como
se hizo con la OEFA (ver [Cómo funciona](#cómo-funciona-estructura-descubierta)).
**Nada más cambia**: la gestión de sesión y `ViewState`, la paginación, la
descarga de PDFs y el manejo de errores 429 son agnósticos del sitio y se
reutilizan sin modificaciones.

> Nota: el objetivo del Poder Judicial no se incluye preconfigurado porque sus
> identificadores JSF no pueden verificarse sin VPN a Perú; añadir valores no
> comprobados daría una falsa impresión de estar probado. La OEFA queda como el
> objetivo por defecto, verificable de forma reproducible.

## Notas

- Este scraper se desarrolló con fines del desafío técnico. Aplica delays y
  reintentos respetuosos con el servidor.

## Licencia

MIT.
