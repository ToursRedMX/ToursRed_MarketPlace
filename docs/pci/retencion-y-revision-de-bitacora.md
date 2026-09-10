# Retención y revisión de la bitácora

**Última medición:** 10 de septiembre de 2026
**Requisitos que atiende:** PCI DSS v4 **10.4** (revisión periódica) y **10.5.1**
(retención: 12 meses, con al menos 3 disponibles de inmediato).

> El mapeo a requisitos es una **propuesta**. Aquí nadie es QSA. Y **si el SAQ
> final resulta ser A, buena parte del Requisito 10 no aplica**: esta política
> está escrita para el caso más exigente, que es el prudente mientras el
> adquirente no confirme lo contrario.

---

## 1. Qué se registra hoy

`public.audit_logs_AAAA`, particionada por año, con particiones creadas hasta
**2029**. RLS activo y lectura restringida a super admin y `service_role`.

Campos:

```
actor_id, actor_email, actor_role, target_id, target_table, action,
old_values, new_values, diff, ip_address, ip_masked, user_agent,
session_id, correlation_id, metadata, error_message, severity,
created_at, country, country_code, city, region, source_platform
```

Eso cubre lo que pide 10.2: **quién**, **qué**, **cuándo**, **desde dónde** y
**con qué sesión**, además del antes y el después del dato (`old_values`,
`new_values`, `diff`).

Complementan:

- **`failed_login_attempts`** — 40 registros al 10-sep, RLS activo.
- **`audit_errors`** — donde se asientan los fallos que se decidió no propagar,
  con `error_message`, `sqlstate` y `raw_payload`.

---

## 2. El estado real, medido — y por qué hay que decirlo ya

| | |
|---|---|
| Registro más antiguo | **25-jun-2026** |
| Registro más reciente | 10-sep-2026 |
| Total en la partición 2026 | **1,398** |
| Historia acumulada | **~2.5 meses** |
| Tipos de acción distintos | 29 |
| Niveles de severidad | 3 |

**Aquí está el problema, y no se arregla escribiendo una política:** 10.5.1 pide
**12 meses** de historia. Hoy hay dos y medio, y eso **no se puede recuperar
retroactivamente**. El reloj corre desde que empieza a acumularse.

Con la auditoría apuntando a noviembre de 2026, la historia disponible será de
unos **cinco meses**. La consecuencia práctica:

- **Es un hallazgo que el auditor va a levantar**, y es mejor llegar con él
  reconocido y con fecha de cumplimiento que con una explicación improvisada.
- **La acción es no borrar nada.** Suena obvio, pero el riesgo real es que
  alguien "limpie" la tabla por espacio o que una partición se recicle. Mientras
  no se toque, en junio de 2027 se cumplen los 12 meses.
- Los **3 meses disponibles de inmediato** sí se cumplen ya: todo está en línea,
  en la base, consultable sin restaurar nada.

### Dos huecos de calidad del dato

De los 1,398 registros:

| | |
|---|---|
| Sin `actor_id` | **663** (47%) |
| Sin `ip_address` | **795** (57%) |

Ese número asusta menos cuando se abre, y hay que abrirlo bien porque una parte
es **correcta por diseño** y otra **sí es un hueco**:

**Correcto por diseño:**

- **`FAILED_LOGIN`** — 39 eventos, los 39 sin actor, pero **cero sin IP**. Un
  intento fallido no tiene usuario autenticado; lo que importa es el origen, y
  ese está.
- **`PAYMENT_RECEIVED`** — 60 eventos sin actor. Los origina un webhook del
  procesador, no una persona. No hay IP de usuario que registrar.

**Hueco real — y resultó bastante mayor de lo que decía esta lista:**

- **`DELETE`** — **75 eventos, los 75 sin actor y sin IP**. Un borrado sin
  atribución es exactamente lo que 10.2 quiere evitar.
- **`UPDATE`** — 357 eventos, 332 sin actor y los 357 sin IP.
- **Pero no son solo esos dos.** Al medir el resto el 10-sep-2026 salió que
  **ningún** evento de negocio trae IP: **795 de 795**. `DELETE` y `UPDATE` no
  son el hueco, son dos ejemplos de él. Y `session_id` y `correlation_id` están
  vacíos en **los 1,400 registros**, pese a que el inventario de controles los
  presentaba como campos capturados. **Cerrado el 10-sep-2026**: la migración
  `20260910190000` hace que `insert_audit_log` deduzca el contexto de la
  petición y **está aplicada en producción**, y las 49 Edge Functions que
  escriben en tablas auditadas reenvían el origen del cliente, vigiladas por
  `check-audit-context.mjs`. Los 1,400 registros viejos siguen sin origen: no
  hay backfill posible, ese dato nunca existió. Conviene que la **primera
  revisión** que se corra con este procedimiento compruebe que los eventos
  nuevos sí lo traen — hoy está probado en CI, no observado en producción.

**La causa es arquitectónica y conviene explicarla tal cual:** estos registros los
escriben *triggers* de base de datos, y un trigger no tiene contexto HTTP — no
conoce la IP ni el user agent, y solo conoce el actor si la sesión trae
`auth.uid()`. Los eventos que sí traen IP (`FAILED_LOGIN`) son los que se
escriben desde la aplicación, que sí lo sabe.

Cerrarlo pide propagar el contexto del llamador hacia el trigger, por ejemplo con
variables de sesión (`set_config`) fijadas al inicio de la petición. **Es un
cambio de código, no de política, y por eso no se hace aquí.**

---

## 3. Política de retención

1. **Retención mínima: 12 meses** de bitácora de auditoría. Las particiones
   anuales existen hasta 2029, así que no hace falta nada nuevo para cumplirlo:
   basta **no borrar**.
2. **Disponibilidad inmediata: 3 meses**, consultables en línea sin restaurar.
   Se cumple hoy.
3. **Ninguna partición de `audit_logs_*` se elimina ni se trunca** sin
   autorización escrita del responsable de cumplimiento. Si algún día hace falta
   archivar por volumen, se archiva —a los respaldos de Backblaze B2— **antes**
   de eliminar, y se deja constancia de qué se archivó y dónde.
4. **La bitácora es de solo lectura para los operadores.** El acceso está
   restringido por RLS a super admin y `service_role`.
5. **Los respaldos cubren la bitácora**, por los workflows de respaldo a
   Backblaze B2, cuya restauración se prueba con `test-dr-restore.yml`.

**Fecha en que se cumplen los 12 meses:** 25 de junio de 2027, si no se borra nada.

---

## 4. Procedimiento de revisión periódica

10.4 no pide solo revisar: pide que **quede constancia** de que se revisó. Un
procedimiento que nadie ejecuta y del que no hay registro no vale.

### Cadencia

| Qué | Cada cuándo | Quién |
|---|---|---|
| Eventos de seguridad y accesos privilegiados | **Diario** | por definir |
| Revisión completa y firma | **Semanal** | por definir |
| Regeneración del inventario de terceros | **Trimestral** | por definir |

Los responsables están sin asignar **a propósito**: los pone Axel, no este
documento. Un nombre inventado aquí sería peor que un hueco declarado.

### Consultas para hacerla

Están escritas para poder correrse tal cual. Si la revisión es incómoda, no se
hace.

```sql
-- 1. Accesos y cambios de usuarios privilegiados (último día)
SELECT created_at, actor_email, actor_role, action, target_table, ip_address
FROM public.audit_logs_2026
WHERE created_at >= now() - interval '1 day'
  AND actor_role IN ('admin','accountant','account_executive')
ORDER BY created_at DESC;

-- 2. Intentos de login fallidos, agrupados por origen
SELECT ip_address, count(*) AS intentos, max(created_at) AS ultimo
FROM public.audit_logs_2026
WHERE action = 'FAILED_LOGIN' AND created_at >= now() - interval '1 day'
GROUP BY ip_address HAVING count(*) > 3
ORDER BY intentos DESC;

-- 3. Borrados: lo que más importa, y hoy lo que peor se atribuye
SELECT created_at, actor_email, target_table, target_id, old_values
FROM public.audit_logs_2026
WHERE action = 'DELETE' AND created_at >= now() - interval '7 days'
ORDER BY created_at DESC;

-- 4. Cambios de rol o de estado de cuenta
SELECT created_at, actor_email, target_id, diff
FROM public.audit_logs_2026
WHERE target_table = 'users'
  AND (diff ? 'role' OR diff ? 'is_active' OR diff ? 'is_super_admin')
  AND created_at >= now() - interval '7 days'
ORDER BY created_at DESC;

-- 5. Severidad alta
SELECT created_at, severity, action, actor_email, error_message
FROM public.audit_logs_2026
WHERE severity NOT IN ('info','low') AND created_at >= now() - interval '7 days'
ORDER BY created_at DESC;

-- 6. Fallos asentados a proposito (revocaciones, snapshots fiscales)
SELECT attempted_at, error_message, sqlstate, raw_payload->>'funcion' AS funcion
FROM public.audit_errors
WHERE attempted_at >= now() - interval '7 days'
ORDER BY attempted_at DESC;

-- 7. Salud de la propia bitacora: que siga escribiendo
SELECT date_trunc('day', created_at) AS dia, count(*)
FROM public.audit_logs_2026
WHERE created_at >= now() - interval '14 days'
GROUP BY 1 ORDER BY 1 DESC;
```

La número 7 no es de relleno. **Una bitácora que deja de escribir se ve igual que
un periodo sin incidentes**, y ese es el fallo silencioso que un control de
logging tiene que poder detectar de sí mismo.

### Primera corrida, 10-sep-2026

Las siete consultas se ejecutaron contra producción al escribir este documento.
No es un detalle de forma: **un procedimiento que nadie ha corrido no está
probado**, y publicar consultas rotas dentro de un documento de auditoría sería
peor que no publicarlas.

Resultados sobre los últimos 365 días, que sirven de línea base:

| Consulta | Resultado |
|---|---|
| 1 — privilegiados (último día) | 1 evento |
| 2 — IPs con más de 3 logins fallidos | **1 IP** |
| 3 — borrados | 75 |
| 4 — cambios de rol o estado de cuenta | 2 |
| 5 — severidad por encima de `info`/`low` | **162** |
| 6 — fallos asentados en `audit_errors` | 31 |
| 7 — días con escritura, de los últimos 14 | **13 de 14** |

Dos cosas que la propia corrida deja sobre la mesa:

- **Hay una IP con más de 3 intentos fallidos.** Puede ser alguien que olvidó su
  contraseña, o no. La primera revisión formal debería mirarla.
- **162 eventos de severidad alta en el año** es demasiado para revisar de golpe
  cada semana. O la clasificación de severidad está calibrada de más, o hace
  falta filtrar mejor. Conviene resolverlo antes de que la revisión se vuelva un
  trámite que nadie lee, que es como mueren estos controles.

La 7 dio 13 de 14 días: la bitácora escribe de forma consistente.

### Constancia

Cada revisión deja: **fecha, quién revisó, qué consultas corrió, qué encontró y
qué se hizo**. Puede ser un archivo por semana en `docs/pci/revisiones/`, un
ticket, o lo que el equipo ya use — lo que no puede es no existir.

---

## 5. Pendientes que salen de este documento

| # | Pendiente | Tipo | Quién |
|---|---|---|---|
| 1 | **No borrar bitácora.** Los 12 meses se cumplen el 25-jun-2027 | Operativo | equipo |
| 2 | **Atribuir los `DELETE`**: propagar actor e IP a los triggers | **Código** | pendiente |
| 3 | Asignar responsables de la revisión diaria y semanal | Organizativo | **Axel** |
| 4 | Definir dónde vive la constancia de cada revisión | Organizativo | **Axel** |
| 5 | Confirmar con el adquirente si el Requisito 10 aplica según el SAQ | Externo | **Axel** |

El **2** es el único técnico, y es el que más peso tiene ante un auditor: un
borrado sin autor es difícil de defender. El **5** puede volver irrelevante a
todo lo demás, así que conviene resolverlo primero.
