# Gestión de vulnerabilidades de terceros

**Fecha:** 11 de septiembre de 2026
**Requisito:** PCI DSS v4 **6.3.1**.
**SAQ:** A — aplica al servidor web que aloja la página que da la URL del
procesador, o sea nuestro front.

> **6.3.1 no es el inventario.** El inventario es 6.3.2 y ya existe en
> [`inventario-de-componentes-de-terceros.md`](inventario-de-componentes-de-terceros.md),
> vigilado por `guardia-dependencias`. Lo que 6.3.1 pide es distinto y es lo que
> faltaba: **monitorear activamente** fuentes de vulnerabilidades y **asignarles
> un ranking de riesgo**.
>
> El propio SAQ lo aclara: *«este requisito no se logra con, ni es lo mismo que,
> los escaneos de vulnerabilidad de 11.3.1 y 11.3.2»*.

---

## 1. Qué se monitorea

| Superficie | Componentes | Cómo llegan los avisos |
|---|---|---|
| **Front** | 24 dependencias directas, 417 resueltas en `package-lock.json` | Avisos de seguridad de npm y de GitHub |
| **Edge Functions** | 6 componentes, versiones fijas desde el PR #198 | Avisos de npm y de JSR |
| **`xlsx` (SheetJS)** | Front 0.20.3, Edge 0.18.5 | **Manual.** Ver abajo |
| **Plataforma** | Netlify, Supabase | Sus propios boletines de seguridad |

### `xlsx` merece su propio párrafo

Es la única dependencia que **no viene del registro de npm**: se resuelve desde
`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`.

Consecuencia directa: **no aparece en los avisos de seguridad de npm**. Ninguna
herramienta que monitoree por el registro lo va a cubrir. Su seguimiento tiene
que ser deliberado, contra los avisos del propio SheetJS.

Y corre en **dos versiones distintas** —0.20.3 en el front, 0.18.5 en las Edge
Functions—, así que un aviso hay que evaluarlo dos veces.

---

## 2. Fuentes que hay que vigilar

1. **GitHub Security Advisories** del repositorio — cubre npm automáticamente si
   está activado Dependabot alerts. **Comprobar que lo está.**
2. **Avisos de SheetJS**, en su sitio. Es el único camino para `xlsx`.
3. **Boletines de Supabase y Netlify**, por su canal de estado o correo.
4. **CERT/CC y el CISA KEV** para lo que afecte a la cadena de suministro de
   JavaScript de forma amplia. Es lo que el requisito llama *«fuentes
   reconocidas de la industria, incluidos los CERT»*.

---

## 3. Cómo se asigna el ranking

6.3.1 pide que el ranking **identifique, como mínimo, todo lo que sea de riesgo
alto o crítico**. No pide una escala propia sofisticada; pide un criterio
consistente y escrito.

**El criterio es CVSS v3.1, ajustado por si el componente es alcanzable:**

| Ranking | CVSS base | Y además |
|---|---|---|
| **Crítico** | ≥ 9.0 | o cualquier CVSS ≥ 7.0 en algo que **se ejecuta en el navegador del cliente** |
| **Alto** | 7.0 – 8.9 | |
| **Medio** | 4.0 – 6.9 | |
| **Bajo** | < 4.0 | |

**El ajuste es lo que hace útil al criterio.** Una vulnerabilidad de CVSS 7.5 en
una librería que solo corre en una Edge Function de administración no es lo
mismo que la misma vulnerabilidad en algo que se carga en la página desde la que
el viajero sale al checkout. La segunda toca el flujo de pago; la primera no.

**Un componente que no se ejecuta en producción no puntúa.** Las dependencias de
desarrollo no llegan al navegador ni al servidor.

---

## 4. Plazos de remediación

| Ranking | Plazo |
|---|---|
| **Crítico** | 7 días naturales |
| **Alto** | 30 días |
| **Medio** | 90 días |
| **Bajo** | Se registra; se atiende con el mantenimiento normal |

**Si no se puede remediar en plazo**, se documenta: qué es, por qué, qué mitiga
el riesgo mientras tanto, y cuándo se revisará. Un plazo incumplido y explicado
es defendible; uno incumplido y callado, no.

---

## 5. Constancia

6.3.1 no pide solo mirar: pide poder demostrar que se mira. Lo que se guarda:

| Qué | Dónde |
|---|---|
| Avisos evaluados y su ranking | Un issue en GitHub por aviso, etiquetado `seguridad` |
| Decisión y fecha de remediación | El PR que la aplica, enlazado desde el issue |
| Lo que se decidió no remediar y por qué | El mismo issue, cerrado con la justificación |

**Un issue cerrado con «no aplica porque el componente no llega al navegador» es
evidencia válida.** Lo que no vale es que no haya rastro.

### Revisión periódica

| Qué | Cada cuándo |
|---|---|
| Revisar avisos pendientes y su ranking | **Semanal** |
| Regenerar el inventario del front | **Trimestral** — ver el comando en el inventario |
| Comprobar avisos de SheetJS a mano | **Trimestral**, junto con lo anterior |

El inventario de Edge Functions **no hace falta regenerarlo**: `guardia-dependencias`
lo publica en el resumen de cada PR.

---

## 6. Responsables

| Rol | Quién |
|---|---|
| Revisar avisos semanalmente y asignar ranking | por definir |
| Comprobar los avisos de SheetJS | por definir |
| Aprobar una remediación fuera de plazo | **Axel** |

Sin asignar a propósito: los nombres los pone Axel.

---

## 7. Lo que ya está resuelto y no hay que repetir

- **Saber qué corre y en qué versión** (6.3.2): resuelto. Los 526 imports
  remotos de las Edge Functions tienen versión exacta desde el PR #198, y
  `guardia-dependencias` impide que entre uno sin ella.
- **El lockfile del front** fija las 417 dependencias resueltas.
- **`scripts/edge-check/deno.lock`** fija también las transitivas de las Edge
  Functions, incluida `openai@4.104.0`, que entra como dependencia de
  `@supabase/functions-js` y no se controla desde nuestro código.
