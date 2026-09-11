# Cumplimiento PCI DSS — ToursRed

**SAQ: A**, determinado el 10-sep-2026.
**Estado: un solo pendiente técnico — contratar el ASV.**

> ToursRed usa **checkout alojado en los cinco procesadores**: el viajero sale a
> la página del procesador y ningún dato de tarjeta pasa por nuestro sitio. Eso
> es lo que sostiene SAQ A, la modalidad más corta.
>
> **El mapeo a requisitos es una propuesta razonada. Aquí nadie es QSA**, y el
> SAQ lo determina el adquirente. Estos documentos sirven para llegar preparado
> a esa conversación, no para sustituirla.

---

## Por dónde empezar

| Documento | Para qué |
|---|---|
| **[`mapeo-saq-a.md`](mapeo-saq-a.md)** | **Empezar aquí.** Qué requisitos aplican de verdad, cuáles no, y el estado de cada uno |

## Los cuatro documentos de control

| Documento | Requisito |
|---|---|
| [`politica-de-escaneos.md`](politica-de-escaneos.md) | 11.3.2 y 11.3.2.1 — escaneo ASV trimestral y tras cambio significativo |
| [`proveedores-y-responsabilidades.md`](proveedores-y-responsabilidades.md) | 12.8.1 a 12.8.5 — lista de terceros, acuerdos, monitoreo y matriz de responsabilidades |
| [`gestion-de-vulnerabilidades.md`](gestion-de-vulnerabilidades.md) | 6.3.1 — monitoreo de avisos y criterio de ranking |
| [`plan-de-respuesta-a-incidentes.md`](plan-de-respuesta-a-incidentes.md) | 12.10.1 — qué se hace ante un incidente y a quién se avisa |

## La evidencia técnica

| Documento | Para qué |
|---|---|
| [`2026-09-10-inventario-de-controles-tecnicos.md`](2026-09-10-inventario-de-controles-tecnicos.md) | Los controles que ya existen, con el apuntador exacto a su evidencia y cómo reproducirla |
| [`inventario-de-componentes-de-terceros.md`](inventario-de-componentes-de-terceros.md) | 6.3.2 — qué software de terceros corre y en qué versión |
| [`retencion-y-revision-de-bitacora.md`](retencion-y-revision-de-bitacora.md) | La bitácora. **Ojo: el Requisito 10 no está en SAQ A** — se conserva como control propio |
| [`escaneos-y-pruebas-de-intrusion.md`](escaneos-y-pruebas-de-intrusion.md) | Por qué el ASV es obligatorio y el pentest no |

---

## Lo que falta, en una tabla

### Pendiente técnico

| | Quién | Por qué manda el calendario |
|---|---|---|
| **Contratar el ASV** y correr el primer escaneo | **Axel** | Es tiempo de un tercero certificado. Lo demás son días de trabajo; esto no se comprime |

**La buena noticia del calendario:** para la **primera** certificación no hacen
falta cuatro escaneos aprobados. Basta el más reciente aprobado, la política
escrita —que ya existe— y evidencia de remediación. Los cuatro se exigen desde
el segundo año.

### Datos que hay que conseguir

| Dato | Dónde va |
|---|---|
| **AOC de los cinco procesadores** | `proveedores-y-responsabilidades.md` §1 |
| Cláusula de responsabilidad de cada proveedor (12.8.2) | §2 del mismo |
| Contacto de notificación del adquirente | `plan-de-respuesta-a-incidentes.md` §1 |
| Nombres de los responsables | los cuatro documentos de control |
| Obligación legal de notificación en México | plan de incidentes §6 |

**El AOC de los procesadores es el que más pesa:** sostiene la elegibilidad para
SAQ A. Sin él no se puede afirmar que se es SAQ A, y toda esta carpeta cambia de
alcance.

### Antes de firmar

Leer el **SAQ A v4.0.1 r1** completo. Estos documentos se construyeron sobre el
SAQ A de **v4.0 (abril 2022)** más los cambios confirmados de enero de 2025. Las
secciones coinciden, pero el que se firma es la r1.

---

## Una nota sobre cómo leer esta carpeta

Varios de estos documentos **se corrigieron a sí mismos** durante su
elaboración, y las correcciones están dichas dentro en vez de borradas. No es
descuido: es que un documento de cumplimiento que solo enseña conclusiones
limpias no deja ver de dónde salieron.

Dos ejemplos que conviene conocer porque cambian decisiones:

- `escaneos-y-pruebas-de-intrusion.md` afirmaba que en SAQ A los escaneos ASV
  «generalmente no aplican». **Es falso bajo v4**, y ese error habría llevado a
  no contratar un ASV obligatorio.
- El inventario de controles daba `guardia-search-path` por bloqueante y
  presentaba como capturados unos campos de bitácora que estaban vacíos en el
  100% de los registros.

**Ante cualquier duda entre un documento y el sistema, gana el sistema.** Por eso
donde se pudo se dejó el comando que lo comprueba en vez del número.
