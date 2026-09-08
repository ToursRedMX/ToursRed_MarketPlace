# ToursRed

Plataforma de marketplace para tours y experiencias de viaje.

## Requisitos del build

### `npm install` necesita acceso a `cdn.sheetjs.com`

La dependencia `xlsx` **no se instala desde el registro de npm**, sino desde un tarball
del CDN de SheetJS:

```json
"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"
```

Si esa URL no responde —CDN caído, red corporativa, proxy que la bloquea—, **`npm install`
falla entero**, no solo esa dependencia. Es la forma que SheetJS documenta desde que
sacó su distribución de npm en 2022.

> [!WARNING]
> **No muevas `xlsx` al registro de npm "para limpiar el `npm audit`".** Es la trampa
> más fácil de caer aquí, y te mete dos vulnerabilidades altas.

#### Por qué

`xlsx` en npm quedó **congelado en la 0.18.5, publicada en marzo de 2022**, con dos
avisos de seguridad **sin versión corregida disponible en ese registro**:

| Aviso | Problema | Vulnerable en |
|---|---|---|
| [GHSA-4r6h-8v6p-xvw6](https://github.com/advisories/GHSA-4r6h-8v6p-xvw6) | Prototype Pollution | `< 0.19.3` |
| [GHSA-5pgg-2g8v-p4x9](https://github.com/advisories/GHSA-5pgg-2g8v-p4x9) | ReDoS | `< 0.20.2` |

La versión que usa este repo (**0.20.3**) está por encima de los dos umbrales. Bajar al
paquete de npm sería retroceder cuatro años y meter ambas.

Existe `@e965/xlsx@0.20.3` en npm, una republicación comunitaria de la misma versión y
sin avisos. Se evaluó y **se descartó a propósito**: cambia una fuente oficial por una de
terceros que no se puede contrastar contra el original. Se vería mejor en `npm audit` y
sería peor posición de cadena de suministro.

#### Lo que sí está cubierto

El `package-lock.json` guarda el `integrity` (`sha512-oLDq3jw7…`) del tarball, así que
**npm verifica el contenido al instalarlo**. Si el CDN sirviera algo distinto, la
instalación falla. El riesgo de manipulación está cerrado; lo que queda es
disponibilidad.

#### Lo que no está cubierto

- **Dependabot y `npm audit` no ven esta dependencia**, porque es una URL y no un paquete
  del registro. Las actualizaciones de SheetJS hay que seguirlas a mano en
  <https://cdn.sheetjs.com/>.
- **La versión está clavada en la URL**: actualizar es editar `package.json` y
  regenerar el lockfile.

#### Cuánto importa hoy

Este repo **sólo escribe** hojas de cálculo, nunca las lee: las cuatro llamadas son
`book_new`, `aoa_to_sheet`, `json_to_sheet` y `writeFile`, en
`src/utils/reportExports.ts`, `src/pages/admin/AdminReporteMaestro.tsx`,
`src/pages/admin/TermsManagementPage.tsx` y `src/pages/agency/AgencyFinancials.tsx`. No
hay un solo `XLSX.read`.

Las dos vulnerabilidades de arriba se disparan **parseando** archivos maliciosos, así que
en este código ese camino no existe. Eso cambiaría el día que se acepte subir un `.xlsx`
de un usuario — y ahí sí habría que revisar de nuevo.

---

Contexto completo en `docs/auditorias/2026-09-05-auditoria-frontend.md`, hallazgo **F-5**.
