# Escaneos de vulnerabilidades y pruebas de intrusión

**Fecha:** 10 de septiembre de 2026
**Requisito que atiende:** PCI DSS v4 **11.3** (escaneos internos y externos) y
**11.4** (pruebas de intrusión).
**SAQ: A**, determinado el 10-sep-2026.
**Estado: el ASV trimestral es OBLIGATORIO y no está contratado.**

> El mapeo a requisitos es una **propuesta**. Aquí nadie es QSA.
>
> **Este documento se corrigió el 10-sep-2026 en su punto más importante.** Decía
> que en SAQ A los escaneos ASV «generalmente no aplican», y bajo PCI DSS v4 eso
> es falso: el Requisito 11.3.2 se añadió a SAQ A precisamente para comercios
> como este. La sección 1 explica el cambio y por qué importa.

---

## Por qué este documento es corto

Los otros documentos de esta carpeta inventarían cosas que ya existen. **Este no
inventaría nada, porque no hay nada que inventariar todavía.** Está aquí para que
el hueco tenga forma y dueño en vez de aparecer como sorpresa en la auditoría.

Y hay una razón dura por la que no puede resolverse desde dentro: **un escaneo ASV
tiene que ejecutarlo un Approved Scanning Vendor**, un proveedor certificado por
el PCI Security Standards Council. No es una herramienta que se corra en CI ni
algo que el equipo pueda producir por su cuenta. **Es una contratación.**

---

## 1. El SAQ es A. Y eso NO libra de los escaneos ASV.

**Determinado el 10-sep-2026: SAQ A.** Los cinco procesadores usan checkout
alojado —el viajero sale a la página del procesador— así que ningún dato de
tarjeta pasa por nuestro sitio. Con `/test-openpay-3ds` eliminado (PR #195) no
queda ningún formulario de tarjeta servido desde nuestro dominio, que era lo
único que empujaba hacia A-EP.

### La corrección que trae esta versión

**Este documento decía, en su versión del 10-sep-2026, que en SAQ A los escaneos
ASV «generalmente no aplican». Es falso bajo PCI DSS v4.**

| | v3.2.1 | **v4.x** |
|---|---|---|
| ASV trimestral en SAQ A | no aplicaba | **SÍ aplica** |

El PCI SSC **añadió** el Requisito 11.3.2 a SAQ A en la versión 4, y lo hizo a
propósito: los comercios SAQ A estaban siendo vulnerados a un ritmo alarmante
—justamente por la vía de la página que redirige— y el escaneo externo es lo que
detecta eso. Aplica al sistema del comercio que aloja la página que redirige al
tercero o que embebe su formulario. **Es exactamente nuestro caso.**

Todos los requisitos con fecha futura de PCI DSS v4 son obligatorios desde el
**31 de marzo de 2025**, así que no hay periodo de gracia que esperar.

**Por qué importaba corregirlo:** un error en esta dirección no falla
ruidosamente. Lleva a no contratar un ASV que sí es obligatorio, y eso se
descubre en la auditoría, con la fecha encima.

### La cadencia es trimestral, no semestral

**Cada 90 días**, y el resultado tiene que ser **aprobatorio**: un escaneo con
hallazgos no cierra el requisito, hay que remediar y **reescanear** hasta pasar.
No existe modalidad semestral en PCI DSS; si alguien la menciona, está pensando
en otro marco.

Eso cambia la planeación: no es una contratación de una vez, son **cuatro
ciclos al año**, y el primero conviene tenerlo **antes** de la auditoría para no
llegar con el primer escaneo sin remediar.

---

## 2. Si resulta que aplica: qué habría que escanear

Los activos con cara a internet, para que la conversación con el ASV no empiece
en blanco:

| Activo | Qué es | Quién lo opera |
|---|---|---|
| `toursred.com` y su preview | front estático | Netlify |
| `*.supabase.co` del proyecto | API REST, Auth, Edge Functions, Storage | Supabase |

**Los dos son de terceros**, y eso cambia el trabajo: buena parte de lo que un ASV
escanearía cae bajo la responsabilidad de Netlify y Supabase, no nuestra. Ambos
publican su propio material de cumplimiento, y **conseguirlo es más barato que
escanear** lo que ya está cubierto por ellos.

**Acción sugerida:** antes de contratar, pedir a Netlify y a Supabase su
documentación de cumplimiento PCI/SOC y ver cuánto del alcance queda cubierto por
herencia.

---

## 3. Lo que sí se puede adelantar sin contratar a nadie

Ninguna de estas sustituye un ASV, pero todas reducen lo que un escaneo va a
encontrar, y ninguna cuesta dinero:

1. **Cerrar el inventario de terceros** (`inventario-de-componentes-de-terceros.md`).
   Un escaneo que encuentra una dependencia vieja documentada y con fecha de
   parcheo se resuelve distinto que uno que la encuentra por sorpresa.
2. **Fijar las versiones de las Edge Functions.** Hoy tres de sus seis componentes
   flotan en el mayor, así que no se puede afirmar qué versión corre. Ante un
   aviso de seguridad, eso es lo primero que estorba.
3. **Revisar las cabeceras HTTP** que sirve Netlify (HSTS, CSP,
   `X-Content-Type-Options`, `Referrer-Policy`). Son de los hallazgos más comunes
   en un escaneo externo y se corrigen con configuración, no con código.
4. **Cerrar los pendientes técnicos ya identificados**: el `account_executive` sin
   MFA, y la atribución de los `DELETE` en la bitácora.

Los puntos 1 y 2 ya tienen su documento y su diagnóstico. El **3 no se ha
revisado** y probablemente sea el de mejor relación esfuerzo/resultado de la
lista.

---

## 4. Pruebas de intrusión (11.4): NO son obligatorias en SAQ A

Al contrario que los escaneos ASV, aquí la exención sí se sostiene: **SAQ A está
generalmente exento del Requisito 11.4.** Las pruebas de intrusión se exigen en
SAQ D, A-EP y C, que son las modalidades donde el comercio tiene sistemas de cara
a internet que influyen en la transacción.

**Pero hacerlo igual es buena idea, y es decisión tomada.** Un pentest interno no
cierra un requisito de PCI; cierra la pregunta de si la plataforma tiene huecos
que nadie ha buscado. Son cosas distintas y conviene no confundirlas al
presentarlo:

- **Ante el auditor**, es evidencia de diligencia, no cumplimiento de 11.4. No
  hay que apuntarlo como si cerrara el requisito, porque no lo cierra y el QSA
  lo va a notar.
- **Para el negocio**, es lo único de esta lista que busca fallos que no están
  en ninguna lista de requisitos.

Si se contrata externo, conviene saber que **11.4 no exige que sea un QSA ni un
ASV**: pide un recurso interno cualificado o un tercero con independencia
organizacional. O sea que la barra es de competencia, no de certificación.

---

## Resumen

| # | Pendiente | Tipo | Quién |
|---|---|---|---|
| 1 | ~~Confirmar el SAQ~~ **HECHO: es SAQ A** (10-sep-2026) | — | — |
| 2 | **Contratar ASV — es OBLIGATORIO en SAQ A bajo v4**, cada 90 días con resultado aprobatorio | Contratación | **Axel** |
| 3 | Pedir a Netlify y Supabase su documentación de cumplimiento | Externo | **Axel** |
| 4 | Pentest interno — **no exigido**, buena práctica | Decisión tomada | **Axel** |
| 5 | Revisar cabeceras HTTP de Netlify | Técnico | pendiente |
| 6 | ~~Fijar versiones en Edge Functions~~ **HECHO** (PR #198) | — | — |

**El 2 es ahora el que manda el calendario.** No es una contratación de una vez:
son cuatro ciclos al año, cada uno con su remediación y reescaneo si hay
hallazgos. Con la auditoría apuntando a noviembre, el primer escaneo debería
encargarse con margen suficiente para remediar lo que salga.

**El 1 ya no bloquea nada.** Durante días fue el nudo de esta carpeta: sin saber
el SAQ, ninguna de las demás decisiones se podía tomar. Con SAQ A confirmado,
todo lo de arriba tiene respuesta.
