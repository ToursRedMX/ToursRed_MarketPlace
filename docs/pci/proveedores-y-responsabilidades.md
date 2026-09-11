# Proveedores externos, sus AOC y quién responde por qué

**Fecha:** 11 de septiembre de 2026
**Requisitos:** PCI DSS v4 **12.8.1** a **12.8.5**, y el **criterio de
elegibilidad 4** de SAQ A (haber revisado el AOC de cada procesador).
**SAQ:** A.

> **12.8 se cumple con cinco cosas distintas**, y es fácil confundirlas:
>
> | | |
> |---|---|
> | **12.8.1** | Tener la **lista** de proveedores, con qué hace cada uno |
> | **12.8.2** | Tener **acuerdos escritos** donde reconocen su responsabilidad |
> | **12.8.3** | Tener un **proceso de alta** con diligencia previa |
> | **12.8.4** | **Monitorear su cumplimiento** al menos cada 12 meses |
> | **12.8.5** | Saber **qué requisito gestiona cada quién** |
>
> El SAQ avisa de un error concreto: *«la evidencia de que un TPSP cumple —por
> ejemplo un AOC o una declaración en su web— **no es lo mismo** que el acuerdo
> escrito del 12.8.2»*. Son dos entregables, no uno.

---

## 1. La lista (12.8.1)

### Procesadores de pago — tocan datos de cuenta

| Proveedor | Qué hace | AOC revisado |
|---|---|---|
| **Stripe** | Checkout alojado, suscripciones de membresía, payouts | ⬜ pendiente |
| **PayPal** | Checkout alojado, capturas y reembolsos | ⬜ pendiente |
| **MercadoPago** | Checkout alojado | ⬜ pendiente |
| **Conekta** | Checkout alojado, SPEI, efectivo, BNPL | ⬜ pendiente |
| **OpenPay** | Checkout alojado, tarjeta y CoDi | ⬜ pendiente |

**Estos cinco son los que sostienen la elegibilidad para SAQ A.** El criterio
dice *revisado y confirmado*, así que hace falta el documento, no la reputación.

### Infraestructura — no tocan datos de cuenta, pero podrían afectar su seguridad

| Proveedor | Qué hace | Por qué está en la lista |
|---|---|---|
| **Netlify** | Hosting del front | Sirve la página que da la URL del procesador. **En alcance de 6.3.1, 8 y 11.3.2** |
| **Supabase** | Base de datos, auth, Edge Functions, almacenamiento | Corre la lógica de negocio y guarda todo salvo datos de tarjeta |
| **Cloudflare** | Turnstile en formularios públicos | **Único script de terceros** cargado en el navegador |
| **Backblaze B2** | Destino de los respaldos | Custodia copias de la base |

### Servicios de negocio — no tocan datos de cuenta

| Proveedor | Qué hace |
|---|---|
| **Facturapi** | Timbrado de CFDI |
| **smtp2go** | Envío de correo transaccional |
| **Sentry** | Monitoreo de errores. **Puede arrastrar datos personales en las trazas** |
| **Mapbox** | Mapas y búsqueda de direcciones |
| **IPinfo** | Geolocalización por IP en `geo-lookup` |
| **SheetJS** | Librería `xlsx`, servida desde su CDN y **no desde npm** |
| **Pexels** | Imágenes de catálogo |

---

## 2. Acuerdos escritos (12.8.2)

Lo que pide: acuerdos donde el proveedor **reconozca** que es responsable de la
seguridad de los datos de cuenta que posee, procesa o transmite por nosotros, o
en la medida en que pueda afectar nuestro entorno.

En la práctica, para proveedores de este tamaño, ese reconocimiento vive en sus
**términos de servicio** o en un anexo de tratamiento de datos. Lo que hay que
hacer no es negociar un contrato nuevo: es **localizar la cláusula, guardarla
fechada, y poder enseñarla**.

| Proveedor | Acuerdo localizado |
|---|---|
| Stripe · PayPal · MercadoPago · Conekta · OpenPay | ⬜ pendiente |
| Netlify · Supabase | ⬜ pendiente |
| Cloudflare · Backblaze | ⬜ pendiente |

**Se guardan en `docs/pci/proveedores/<proveedor>-<AAAA-MM-DD>.pdf`**, con la
fecha en que se descargaron — los términos cambian y el auditor pregunta por la
versión vigente cuando se firmó.

---

## 3. Proceso de alta (12.8.3)

**Antes de conectar un proveedor nuevo que toque pagos o datos personales:**

1. **Comprobar su cumplimiento.** Para procesadores, que esté en la lista de
   proveedores de servicio validados del PCI SSC o que entregue AOC vigente.
   Para el resto, su certificación equivalente (SOC 2, ISO 27001).
2. **Localizar y guardar** la cláusula de responsabilidad (12.8.2).
3. **Anotar qué requisitos gestiona** y cuáles quedan de nuestro lado (12.8.5).
4. **Agregarlo a la lista** de este documento, en el PR que lo conecta.
5. **Evaluar si es cambio significativo** para 11.3.2.1 — un procesador nuevo lo
   es; una librería de gráficas no.

**El paso 4 es el que se olvida.** Por eso va en el mismo PR que el código: si
el proveedor entra sin pasar por aquí, la lista deja de ser cierta y 12.8.1 se
incumple en silencio.

---

## 4. Monitoreo anual (12.8.4)

**Cada 12 meses**, para cada proveedor de la sección 1:

- Confirmar que su AOC o certificación **sigue vigente** y no expiró.
- Revisar si cambió el alcance de lo que nos presta.
- Dejar constancia con fecha en este documento.

| Revisión | Fecha | Quién |
|---|---|---|
| Primera | ⬜ pendiente | por definir |

**Un AOC vence.** Esa es la razón de ser de este requisito: el proveedor era
cumplidor cuando se contrató y puede no serlo hoy, y nadie se entera si no se
mira a propósito.

---

## 5. Quién gestiona qué requisito (12.8.5)

La pregunta que el auditor hace, y que sin esta tabla se responde improvisando:

| Requisito | Lo gestiona |
|---|---|
| **2.2.2** — cuentas por omisión en servidores web | **Netlify / Supabase.** No administramos servidores |
| **3.x** — datos de cuenta almacenados | **Los procesadores.** Nosotros no almacenamos ninguno |
| **6.3.1** — vulnerabilidades de componentes | **Compartido.** Ellos parchean su plataforma; nosotros nuestras dependencias → [`gestion-de-vulnerabilidades.md`](gestion-de-vulnerabilidades.md) |
| **8.x** — identificación y autenticación en los servidores web | **Compartido.** Las cuentas de Netlify y Supabase son nuestras; la plataforma es de ellos |
| **9.x** — acceso físico | **Netlify / Supabase / Backblaze.** No tenemos instalaciones en alcance |
| **11.3.2** — escaneo ASV | **Nuestro**, sobre infraestructura de ellos → [`politica-de-escaneos.md`](politica-de-escaneos.md) |
| **12.x** — políticas y proveedores | **Nuestro** |
| Seguridad de la página de pago | **Los procesadores.** Es suya de punta a punta |

---

## 6. Lo que falta, y es de Axel

| # | Acción |
|---|---|
| 1 | Obtener el **AOC** de los cinco procesadores y marcar las casillas de la sección 1 |
| 2 | Localizar y guardar la **cláusula de responsabilidad** de cada proveedor (sección 2) |
| 3 | Asignar **quién** hace la revisión anual (sección 4) |

**El 1 es el que bloquea la elegibilidad para SAQ A.** Los otros dos son
requisitos de 12.8 que se cierran con papeleo, no con decisiones.

Los procesadores grandes suelen publicar su AOC o su carta de cumplimiento en su
portal de cumplimiento o a petición del comercio. Si alguno no lo entrega, eso
**sí es un hallazgo** y hay que decidir qué hacer con ese procesador.
