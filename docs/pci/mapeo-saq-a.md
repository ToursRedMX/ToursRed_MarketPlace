# Mapeo contra SAQ A: qué nos toca de verdad

**Fecha:** 11 de septiembre de 2026
**SAQ:** A, determinado el 10-sep-2026.
**Para qué sirve:** los otros documentos de esta carpeta inventarían lo que
existe. Este dice **qué de todo eso te van a preguntar**, y qué falta.

> **Salvedad de versión, y hay que leerla.** Este mapeo se construyó leyendo el
> **SAQ A de PCI DSS v4.0 (abril 2022)**, que es el PDF público del PCI SSC, más
> los cambios confirmados de enero de 2025. El documento que se firma es el
> **SAQ A v4.0.1 r1**, vigente desde el 31-mar-2025. Las secciones y la mayoría
> de los sub-requisitos coinciden, pero **antes de firmar hay que leer la r1**,
> no esta tabla.
>
> Aquí nadie es QSA. Esto sirve para llegar preparado a la conversación, no para
> sustituirla.

---

## 1. Lo primero: la elegibilidad, que no es un trámite

Antes de la lista de requisitos, el SAQ A pide certificar **seis criterios**.
Si uno falla, no se es SAQ A y toda esta carpeta cambia de alcance.

| # | Criterio | Nuestro caso |
|---|---|---|
| 1 | Solo transacciones sin tarjeta presente (e-commerce o MOTO) | ✅ e-commerce |
| 2 | Todo el procesamiento de datos de cuenta **totalmente externalizado** a un TPSP/procesador certificado | ✅ los cinco procesadores |
| 3 | El comercio **no** almacena, procesa ni transmite datos de cuenta electrónicamente | ✅ medido: 0 campos de tarjeta en `src/` y en `supabase/functions/` |
| 4 | **El comercio ha revisado el AOC de cada TPSP** y confirmado que cumple | ❌ **PENDIENTE** |
| 5 | Cualquier dato de cuenta retenido está en **papel** y no se recibe electrónicamente | ✅ no hay papel |
| 6 | E-commerce: todos los elementos de la página de pago entregados al navegador vienen **directa y únicamente** del TPSP | ✅ checkout alojado en los cinco |

**El 4 es el único que falta, y es trabajo real:** hay que obtener y revisar el
Attestation of Compliance de Stripe, PayPal, MercadoPago, Conekta y OpenPay. No
basta con saber que son grandes; el criterio dice *revisado y confirmado*.

**Y hay un séptimo criterio desde enero de 2025:** confirmar que el sitio **no es
susceptible a ataques de scripts** que puedan afectar el sistema de e-commerce.
Sustituyó a los requisitos 6.4.3 y 11.6.1, que se retiraron del cuestionario.
No es una casilla técnica concreta: es una afirmación que hay que poder
sostener, y la superficie de un solo script de terceros (Turnstile) ayuda a
sostenerla.

---

## 2. Los siete requisitos, y qué nos toca de cada uno

SAQ A cubre las secciones **2, 3, 6, 8, 9, 11 y 12**. No cubre las demás — y eso
incluye el **Requisito 10 completo**, que es donde está la mayor parte de lo que
documentamos.

### Requisito 2 — Configuraciones seguras

**Solo 2.2.2**, y solo para cuentas por omisión del proveedor en los servidores
web. Nuestro front lo sirve Netlify y la base es Supabase gestionada; no
administramos servidores con cuentas por defecto.

**Acción:** confirmarlo por escrito con Netlify y Supabase. Probablemente
*Not Applicable* o cubierto por ellos.

### Requisito 3 — Proteger datos de cuenta almacenados

**3.1.1 y 3.2.1**, y el propio SAQ aclara: *aplica solo a comercios con
registros en PAPEL* que incluyan datos de cuenta.

**Nuestro caso: Not Applicable.** No se imprimen ni guardan recibos con datos de
tarjeta. Hay que marcarlo como N/A y llenar el Apéndice D explicando por qué.

### Requisito 6 — Sistemas y software seguros

**6.3.1**: identificar vulnerabilidades de terceros por fuentes reconocidas,
asignarles un ranking de riesgo, e identificar al menos las de riesgo alto o
crítico. Aplica **al servidor web que aloja la página que da la URL del
procesador** — o sea, nuestro front.

**Lo que ya tenemos:**
[`inventario-de-componentes-de-terceros.md`](inventario-de-componentes-de-terceros.md)
más `guardia-dependencias`, que fija la versión de los 526 imports remotos y
publica el inventario en cada PR.

**Lo que falta:** 6.3.1 no pide solo saber qué corre —eso es 6.3.2— sino
**monitorear activamente** fuentes de vulnerabilidades y **asignar ranking**.
Hoy no hay nadie suscrito a avisos ni un criterio de ranking escrito. Y `xlsx`
viene de un tarball de SheetJS, fuera del registro de npm, así que **no aparece
en los avisos de npm**: su seguimiento tiene que ser manual y deliberado.

### Requisito 8 — Identificar usuarios y autenticar accesos

Incluye al menos **8.3.7** (no repetir las últimas cuatro contraseñas) y
**8.3.9** (si la contraseña es el único factor: cambio cada 90 días, o análisis
dinámico de la postura de la cuenta).

**Ojo con el alcance:** 8.3.9 aplica a componentes **fuera del CDE**, que no
están sujetos a MFA. En SAQ A el CDE es prácticamente inexistente, así que la
pregunta se vuelve **de qué usuarios habla** — y eso lo resuelve el QSA.

**Dato medido:** 8 usuarios activos sin MFA (5 de agencia, 2 viajeros, 1
ejecutivo); los 2 admins sí lo tienen.

**No leí la lista completa del Requisito 8** en el PDF. Antes de firmar hay que
recorrerla entera en la r1.

### Requisito 9 — Acceso físico

**9.4.1, 9.4.1.1, 9.4.2, 9.4.3, 9.4.4 y 9.4.6**, y otra vez el SAQ aclara:
aplica **solo a registros en papel**.

**Nuestro caso: Not Applicable**, con Apéndice D.

### Requisito 11 — Probar la seguridad regularmente

**Aquí está el hueco grande.**

| | |
|---|---|
| **11.3.2** | Escaneo externo por **ASV**, al menos **cada 3 meses**, con resultado aprobatorio y reescaneo hasta pasar. **NO CONTRATADO** |
| **11.3.2.1** | Escaneo externo **después de cada cambio significativo**, resolviendo lo que puntúe **CVSS 4.0 o más** |
| ~~11.6.1~~ | **Retirado** de SAQ A en enero de 2025. Además, el propio SAQ ya decía que con **redirección por URL** se marca *Not Applicable* |

**Dos cosas que cambian la planeación y no aparecen en los resúmenes:**

**1. Para la PRIMERA certificación no hacen falta cuatro escaneos aprobados.**
El SAQ lo dice explícitamente: basta que el evaluador verifique (a) que el
escaneo más reciente pasó, (b) que hay política documentada de escanear cada
tres meses, y (c) que lo encontrado se corrigió y se demostró con un reescaneo.
A partir del segundo año sí se exigen los cuatro.

> Traducido: para noviembre necesitas **un escaneo aprobado y una política
> escrita**, no un año de historial. Eso hace la fecha alcanzable.

**2. El 11.3.2.1 NO exige ASV.** Textual: *«los escaneos los realiza personal
cualificado y existe independencia organizacional del evaluador (no se requiere
que sea un QSA o ASV)»*. O sea que los escaneos por cambio significativo se
pueden hacer en casa, y solo el trimestral necesita proveedor certificado.

**Pruebas de intrusión (11.4): no están en SAQ A.** El pentest interno es
diligencia, no cumplimiento — ver
[`escaneos-y-pruebas-de-intrusion.md`](escaneos-y-pruebas-de-intrusion.md).

### Requisito 12 — Políticas y programas

**12.8.1**: mantener una **lista de todos los TPSP** con los que se comparten
datos de cuenta o que podrían afectar su seguridad, con descripción del servicio
de cada uno.

**No la tenemos como tal**, aunque los insumos están repartidos: los cinco
procesadores, Netlify, Supabase, Cloudflare (Turnstile), smtp2go, Facturapi,
SheetJS, Sentry, Backblaze B2.

El SAQ añade una nota que conviene tener presente: *«usar un TPSP certificado no
hace que la entidad cumpla, ni la releva de su propia responsabilidad»*.

**No leí el resto del Requisito 12** (12.8.2 en adelante, y la concienciación en
seguridad que según el PCI SSC ahora incluye phishing e ingeniería social).
Pendiente de recorrer en la r1.

---

## 3. Lo que este mapeo cambia respecto a lo que creíamos

### Deja de ser obligación

| | Por qué |
|---|---|
| **Requisito 10 entero** (bitácora) | No está en SAQ A. Los ~2.5 meses de retención **dejan de ser hallazgo de auditoría** |
| **Pruebas de intrusión (11.4)** | No están en SAQ A |
| **6.4.3 y 11.6.1** (integridad de scripts) | Retirados en enero de 2025 |

Eso no significa tirarlo: la bitácora sigue sirviendo para saber quién canceló
una reserva. Cambia de **requisito heredado** a **control propio**, y por tanto
se ajusta según lo que le sirva al negocio.

### Pasa a ser obligación, y no estaba en el radar

| | Estado |
|---|---|
| **11.3.2** — ASV cada 90 días | **No contratado.** Es lo único con calendario externo |
| **11.3.2.1** — escaneo tras cambio significativo | No existe el proceso. Se puede hacer en casa |
| **12.8.1** — lista formal de TPSP | Los insumos existen, la lista no |
| **Elegibilidad #4** — revisar los AOC de los cinco procesadores | No hecho |

### Sigue igual

`6.3.1` pide monitoreo activo de vulnerabilidades y ranking de riesgo. Lo que
tenemos cubre el **inventario** (6.3.2); el **monitoreo** no.

---

## 4. Qué hacer, en orden

| # | Acción | Tipo | Quién |
|---|---|---|---|
| 1 | **Contratar ASV** y correr el primer escaneo con margen para remediar | Contratación | **Axel** |
| 2 | Escribir la **política de escaneo trimestral** — sin ella, el escaneo aprobado no basta para la primera certificación | Documento | se puede hacer aquí |
| 3 | **Obtener y revisar los AOC** de Stripe, PayPal, MercadoPago, Conekta y OpenPay | Externo | **Axel** |
| 4 | **Lista formal de TPSP** (12.8.1) con descripción de servicio | Documento | se puede hacer aquí |
| 5 | Definir **quién monitorea avisos de vulnerabilidades** y con qué criterio de ranking (6.3.1), incluido `xlsx` fuera de npm | Decisión + documento | **Axel** define, se documenta aquí |
| 6 | Proceso de **escaneo tras cambio significativo** (11.3.2.1), que no necesita ASV | Técnico | se puede hacer aquí |
| 7 | **Leer el SAQ A v4.0.1 r1 completo** y recorrer los Requisitos 8 y 12, que aquí quedaron a medias | Revisión | antes de firmar |

**El 1 manda el calendario.** Los demás son días de trabajo; ese es tiempo de un
tercero, y es el único que no se puede comprimir.

---

## Procedencia

Lista de requisitos leída del **SAQ A de PCI DSS v4.0 (abril 2022)**, publicado
por el PCI SSC en `listings.pcisecuritystandards.org`. Los cambios de enero de
2025 —retirada de 6.4.3, 11.6.1 y 12.3.1, y el nuevo criterio de elegibilidad
sobre scripts— del boletín del propio PCI SSC.

Las secciones del Requisito 8 y del 12 **no se leyeron completas**, y está dicho
arriba donde corresponde. Un mapeo que finge ser exhaustivo sin serlo es peor
que uno que declara sus huecos.
