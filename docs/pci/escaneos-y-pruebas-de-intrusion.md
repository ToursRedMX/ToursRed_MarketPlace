# Escaneos de vulnerabilidades y pruebas de intrusión

**Fecha:** 10 de septiembre de 2026
**Requisito que atiende:** PCI DSS v4 **11.3** (escaneos internos y externos) y
**11.4** (pruebas de intrusión).
**Estado: NO INICIADO.**

> El mapeo a requisitos es una **propuesta**. Aquí nadie es QSA.

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

## 1. Lo primero: saber si aplica

**El alcance de 11.3 depende del SAQ**, y el SAQ todavía no está determinado.

| SAQ | ¿Escaneos ASV trimestrales? |
|---|---|
| **A** | Generalmente **no** aplican |
| **A-EP** | **Sí**, trimestrales |

Por eso el orden correcto es: **confirmar el SAQ con el adquirente antes de
contratar nada.** Contratar un ASV para descubrir después que se está en SAQ A
sería gastar dinero y tiempo de calendario en algo que no se pedía.

Ese es también el motivo por el que se eliminó `/test-openpay-3ds` (PR #195): era
el único formulario de tarjeta servido desde nuestro dominio, y por lo tanto lo
único que empujaba de forma evidente hacia A-EP. Con esa página fuera, la
conversación con el adquirente empieza desde una posición mucho mejor.

**Acción, y es de Axel:** preguntar al adquirente qué SAQ corresponde, describiendo
el flujo real —redirección a la página del procesador en los cinco casos, sin
captura de tarjeta propia.

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

## 4. Pruebas de intrusión (11.4)

Misma lógica: **el alcance depende del SAQ**, y en las modalidades reducidas suele
no exigirse. Se anota aquí para que la pregunta quede hecha, no porque haya algo
que hacer todavía.

---

## Resumen

| # | Pendiente | Tipo | Quién |
|---|---|---|---|
| 1 | **Confirmar el SAQ con el adquirente** — bloquea todo lo demás | Externo | **Axel** |
| 2 | Pedir a Netlify y Supabase su documentación de cumplimiento | Externo | **Axel** |
| 3 | Contratar ASV **solo si el SAQ lo exige** | Contratación | **Axel** |
| 4 | Revisar cabeceras HTTP de Netlify | Técnico | pendiente |
| 5 | Fijar versiones en Edge Functions | Técnico | pendiente |

**El 1 es el que desbloquea.** Mientras no esté, los demás son especulación:
podrían ser trabajo obligatorio o podrían ser innecesarios, y no hay forma de
saberlo desde el repo.
