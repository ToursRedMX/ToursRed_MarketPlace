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

**El alcance es lo primero que hay que entender aquí**, y cambia la lectura de
todo lo demás. El SAQ dice, textual: *«para SAQ A, el Requisito 8 aplica a los
servidores web del comercio que alojan la página que provee la dirección (la
URL) de la página de pago del TPSP»*.

**No habla de los usuarios de la plataforma.** Habla de las cuentas que
administran el servidor web — o sea, las cuentas de **Netlify y Supabase**, no
las de los viajeros ni las de las agencias.

Lista completa en SAQ A:

| | |
|---|---|
| **8.2.1** | ID único por usuario antes de dar acceso |
| **8.2.2** | Cuentas compartidas o genéricas solo por excepción, con justificación documentada, aprobación, y **cada acción atribuible a una persona** |
| **8.2.5** | El acceso de quien deja la organización se revoca **de inmediato** |
| **8.3.1** | Autenticación con al menos un factor: algo que se sabe, se tiene o se es |
| **8.3.5** | Contraseñas de primer uso y de reinicio: valor único, y **cambio forzado tras el primer uso** |
| **8.3.6** | Mínimo **12 caracteres** (8 si el sistema no soporta 12), con números y letras |
| **8.3.7** | No repetir ninguna de las **últimas cuatro** |
| **8.3.9** | Si la contraseña es el único factor: cambio cada 90 días **o** análisis dinámico de la postura de la cuenta |

**Qué significa para el hueco de MFA que traíamos.** Medimos 8 usuarios activos
sin MFA (5 de agencia, 2 viajeros, 1 ejecutivo) y lo llevábamos como hallazgo de
8.4. Con el alcance de SAQ A a la vista, **esos usuarios probablemente no están
en alcance**: no administran el servidor web. Lo que sí está en alcance son las
cuentas de Netlify y Supabase — y ahí la pregunta es otra: **¿tienen MFA, quién
las comparte, y se revocan al salir alguien?**

Eso no convierte el MFA de las agencias en mala idea; lo saca de la lista de
obligaciones y lo devuelve a decisión de producto. **Y abre una pregunta que no
nos habíamos hecho: si alguien deja el equipo hoy, ¿se le revoca el acceso a
Netlify y a Supabase el mismo día?** Eso es 8.2.5, y sí está en alcance.

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

Son **seis sub-requisitos**, no uno, y se cierran con cosas distintas:

| | | Estado |
|---|---|---|
| **12.8.1** | Lista de TPSP con descripción del servicio | ✅ → [`proveedores-y-responsabilidades.md`](proveedores-y-responsabilidades.md) |
| **12.8.2** | **Acuerdos escritos** donde el TPSP reconoce su responsabilidad | Plantilla lista, faltan los documentos |
| **12.8.3** | Proceso de alta con diligencia previa | ✅ escrito |
| **12.8.4** | Programa para monitorear su cumplimiento **cada 12 meses** | ✅ escrito, falta la primera revisión |
| **12.8.5** | Qué requisito gestiona cada quién | ✅ matriz completa |
| **12.10.1** | **Plan de respuesta a incidentes** | ✅ → [`plan-de-respuesta-a-incidentes.md`](plan-de-respuesta-a-incidentes.md) |

**Dos avisos del propio SAQ que evitan errores caros:**

1. *«Usar un TPSP certificado no hace que la entidad cumpla, ni la releva de su
   propia responsabilidad.»*
2. *«La evidencia de que un TPSP cumple —por ejemplo un AOC o una declaración en
   su web— **no es lo mismo** que el acuerdo escrito del 12.8.2.»* Son dos
   entregables distintos, y es fácil creer que el AOC cubre ambos.

### 12.10.1 no estaba en la primera versión de este mapeo

Apareció al leer el Requisito 12 completo. **Está en SAQ A** y pide un plan de
respuesta a incidentes con siete elementos, entre ellos **notificar a las marcas
de pago y al adquirente** — la parte que distingue un plan de PCI de uno
genérico de TI.

Ya está escrito. Lo único que le falta es el **contacto de notificación del
adquirente**, que es un dato que hay que conseguir y que buscar durante un
incidente es justo lo que el plan existe para evitar.

### Lo que sigue sin leerse

La **concienciación en seguridad** (12.6.x). El PCI SSC menciona que en v4.0.1 el
Requisito 12 incluye phishing e ingeniería social en la capacitación, pero **eso
no aparece en el SAQ A de v4.0** que se leyó aquí. Puede ser una adición de la
r1. **Hay que comprobarlo al leer la r1 antes de firmar.**

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

| # | Acción | Estado |
|---|---|---|
| 1 | **Contratar ASV** y correr el primer escaneo con margen para remediar | ⬜ **PENDIENTE — de Axel** |
| 2 | Política de escaneo trimestral y de cambio significativo | ✅ [`politica-de-escaneos.md`](politica-de-escaneos.md) |
| 3 | Lista formal de TPSP y matriz de responsabilidades (12.8.1–12.8.5) | ✅ [`proveedores-y-responsabilidades.md`](proveedores-y-responsabilidades.md) |
| 4 | Monitoreo de vulnerabilidades y criterio de ranking (6.3.1) | ✅ [`gestion-de-vulnerabilidades.md`](gestion-de-vulnerabilidades.md) |
| 5 | Proceso de escaneo tras cambio significativo (11.3.2.1) | ✅ dentro de la política de escaneos |
| 6 | Plan de respuesta a incidentes (12.10.1) | ✅ [`plan-de-respuesta-a-incidentes.md`](plan-de-respuesta-a-incidentes.md) |
| 7 | Recorrer los Requisitos 8 y 12 completos | ✅ hecho, arriba |

**Queda un solo pendiente técnico: contratar el ASV.** Es lo único que no se
puede resolver desde el repo, porque es tiempo de un tercero certificado.

### Y unos datos que hay que conseguir, que no son trabajo pero sin ellos no cierra

| Dato | Dónde va | Por qué importa |
|---|---|---|
| **AOC de los cinco procesadores** | `proveedores-y-responsabilidades.md` §1 | Sostiene la **elegibilidad** para SAQ A. Sin esto, no se puede afirmar que se es SAQ A |
| **Cláusula de responsabilidad** de cada proveedor | §2 del mismo | Es 12.8.2, y **no lo cubre el AOC** |
| **Contacto de notificación del adquirente** | `plan-de-respuesta-a-incidentes.md` §1 | Es lo más explícito de 12.10.1 |
| **Nombres de los responsables** | los cuatro documentos | Están sin asignar a propósito: los pone Axel |
| **Obligación legal de notificación en México** | plan de incidentes §6 | Declarado como hueco en vez de improvisado |

**El primero es el que más pesa.** Los otros son papeleo; ese sostiene la
premisa entera de esta carpeta.

---

## Procedencia

Lista de requisitos leída del **SAQ A de PCI DSS v4.0 (abril 2022)**, publicado
por el PCI SSC en `listings.pcisecuritystandards.org`. Los cambios de enero de
2025 —retirada de 6.4.3, 11.6.1 y 12.3.1, y el nuevo criterio de elegibilidad
sobre scripts— del boletín del propio PCI SSC.

Las secciones del Requisito 8 y del 12 **no se leyeron completas**, y está dicho
arriba donde corresponde. Un mapeo que finge ser exhaustivo sin serlo es peor
que uno que declara sus huecos.
