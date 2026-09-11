# Plan de respuesta a incidentes

**Fecha:** 11 de septiembre de 2026
**Requisito:** PCI DSS v4 **12.10.1**.
**SAQ:** A.

> **Este requisito apareció al leer el SAQ A completo, no estaba en el mapeo
> inicial.** 12.10.1 sí está en SAQ A y pide un plan de respuesta a incidentes
> listo para activarse, con siete elementos concretos. No es opcional.
>
> El SAQ aclara la escala esperada: *«puede ser un documento sencillo que liste
> a quién llamar ante distintas situaciones, con una revisión anual»*. No pide
> un manual corporativo. Pide que exista, que esté al alcance de todos, y que
> alguien lo haya pensado antes de necesitarlo.

---

## 1. Roles y a quién se avisa

| Rol | Quién | Qué hace |
|---|---|---|
| **Responsable de incidente** | **Axel** | Decide, coordina y es quien habla con terceros |
| **Técnico de guardia** | por definir | Contiene, investiga y ejecuta |
| **Contacto con procesadores** | **Axel** | Notifica al procesador y al adquirente |

### A quién se notifica, y esto es lo que 12.10.1 exige explícitamente

**Marcas de pago y adquirente, como mínimo.** Ese es el punto que distingue un
plan de incidentes de PCI de uno genérico de TI: ante una sospecha de compromiso
de datos de cuenta, la obligación de notificar **no es solo interna**.

| A quién | Cuándo | Cómo |
|---|---|---|
| **Adquirente** | Ante sospecha o confirmación de compromiso de datos de cuenta | Canal del contrato — **⬜ anotar aquí** |
| **Procesador involucrado** | Igual | Su canal de soporte o seguridad |
| **Marcas de pago** | Normalmente a través del adquirente | Según lo que indique el adquirente |

**Falta rellenar el contacto del adquirente.** Buscarlo durante un incidente es
exactamente lo que este documento existe para evitar.

---

## 2. Qué cuenta como incidente

| Nivel | Ejemplos | Respuesta |
|---|---|---|
| **Crítico** | Sospecha de compromiso de datos de cuenta · acceso no autorizado a la base · script desconocido en el sitio · credencial de procesador expuesta | Activación inmediata, notificación externa |
| **Alto** | Acceso no autorizado a una cuenta de administrador · fuga de datos personales · vulnerabilidad crítica explotable en producción | Contención el mismo día, sin notificación externa salvo que escale |
| **Medio** | Intentos de intrusión sin éxito · vulnerabilidad alta sin explotación conocida | Se registra y se atiende en plazo normal |

**Un script desconocido en el sitio es crítico aunque no haya evidencia de
robo.** Es el vector por el que se vulneran los comercios SAQ A, y es la razón
por la que el PCI SSC añadió los escaneos ASV a esta modalidad.

---

## 3. Qué se hace, en orden

1. **Contener.** Cortar el acceso, revocar la credencial, quitar el script,
   deshabilitar la función. Antes que investigar.
2. **Preservar.** No borrar registros ni "limpiar" mientras se investiga.
   `audit_logs` y `webhook_logs` son la evidencia.
3. **Evaluar el alcance.** ¿Tocó datos de cuenta? Si hay duda, se trata como si
   sí hasta demostrar lo contrario.
4. **Notificar**, si aplica según la sección 1. **Antes de terminar de
   investigar** — el adquirente prefiere enterarse pronto y con datos
   incompletos.
5. **Erradicar y recuperar.** Ver la sección 5 para los respaldos.
6. **Escribir qué pasó**, en `docs/pci/incidentes/AAAA-MM-DD-<descripcion>.md`.

---

## 4. Consultas para la evaluación de alcance

Escritas para poder correrse durante un incidente, que es cuando nadie está para
inventar SQL:

```sql
-- Qué hizo una cuenta sospechosa, y desde dónde
SELECT created_at, action, target_table, target_id, ip_address, user_agent
FROM public.audit_logs
WHERE actor_email = 'CORREO_SOSPECHOSO'
ORDER BY created_at DESC LIMIT 200;

-- Todo lo que vino de una IP
SELECT created_at, actor_email, action, target_table
FROM public.audit_logs
WHERE ip_address = 'IP_SOSPECHOSA'
ORDER BY created_at DESC;

-- Accesos privilegiados recientes
SELECT created_at, actor_email, actor_role, action, target_table, ip_address
FROM public.audit_logs
WHERE actor_role IN ('admin','super_admin')
  AND created_at >= now() - interval '7 days'
ORDER BY created_at DESC;

-- Intentos fallidos agrupados por origen
SELECT ip_address, count(*) AS intentos, max(created_at) AS ultimo
FROM public.audit_logs
WHERE action = 'FAILED_LOGIN' AND created_at >= now() - interval '7 days'
GROUP BY ip_address ORDER BY intentos DESC;

-- Eventos de webhook recibidos, por si el incidente viene de un procesador
SELECT event_type, event_id, created_at
FROM public.webhook_logs
WHERE created_at >= now() - interval '7 days'
ORDER BY created_at DESC;
```

**Limitación que hay que conocer de antemano:** los eventos de negocio
anteriores al 10-sep-2026 **no tienen IP registrada**. La migración
`20260910190000` lo corrigió de ahí en adelante, pero para un incidente que
involucre datos viejos, la atribución por origen no está disponible.

---

## 5. Recuperación y continuidad

12.10.1 pide que el plan cubra **recuperación del negocio y respaldos**. Lo que
ya existe:

| | |
|---|---|
| Respaldos | Ocho workflows a Backblaze B2 — base, almacenamiento, datos horarios |
| Restauración probada | `test-dr-restore.yml`, `test-storage-restore.yml`, `test-edge-functions-restore.yml` |
| Recuperar Edge Functions | `docs/drp/recover-missing-edge-functions.yml` |

**Que las restauraciones se prueben es la parte que vale.** Un respaldo que nadie
ha restaurado no es un respaldo, es una esperanza.

---

## 6. Requisitos legales de notificación

Además de lo de PCI, México tiene sus propias obligaciones por datos personales.
**⬜ Pendiente de confirmar con asesoría legal** qué plazo y a quién, para
poder ponerlo aquí. Se deja declarado como hueco en vez de improvisarlo.

---

## 7. Revisión

| Qué | Cada cuándo | Quién |
|---|---|---|
| Revisar que este plan sigue siendo cierto | **Anual**, y tras cualquier incidente | **Axel** |
| Comprobar que los contactos siguen vigentes | Anual | **Axel** |

| Revisión | Fecha |
|---|---|
| Primera | ⬜ pendiente |

---

## 8. Lo que falta

| # | Qué | Quién |
|---|---|---|
| 1 | **Contacto de notificación del adquirente** (sección 1) | **Axel** |
| 2 | Asignar el **técnico de guardia** | **Axel** |
| 3 | Confirmar las **obligaciones legales** de notificación en México (sección 6) | **Axel** / legal |

Los tres son datos, no decisiones técnicas. Pero sin el 1, el plan no cumple lo
que 12.10.1 pide de forma más explícita.
