# Política de escaneos de vulnerabilidad

**Vigente desde:** 11 de septiembre de 2026
**Requisitos:** PCI DSS v4 **11.3.2** (escaneo externo trimestral por ASV) y
**11.3.2.1** (escaneo externo tras cambio significativo).
**SAQ:** A.

> Este documento existe porque **el escaneo aprobado, por sí solo, no basta**.
> Para la primera certificación el evaluador tiene que ver tres cosas: el
> escaneo más reciente aprobado, **esta política**, y evidencia de que lo
> encontrado se corrigió y se demostró con un reescaneo. Sin la política
> escrita, el escaneo no cierra el requisito.

---

## 1. Qué se escanea

El alcance es **lo que está de cara a internet y pertenece a ToursRed**:

| Activo | Quién lo opera | En alcance |
|---|---|---|
| `toursred.com` y subdominios | Netlify | **Sí** — aloja la página que da la URL del procesador |
| `toursredmx.netlify.app` (staging) | Netlify | Sí, si es alcanzable públicamente |
| API y Edge Functions de Supabase | Supabase | **A confirmar con el ASV** — ver abajo |
| Páginas de checkout de los cinco procesadores | el procesador | **No.** Son de ellos y están en su propio alcance |

**Los dos primeros son de terceros gestionados**, y eso hay que decírselo al ASV
antes de contratar: buena parte de lo que un escaneo mira —parches del sistema
operativo, puertos, versiones del servidor web— lo controla Netlify o Supabase,
no nosotros. El propio SAQ lo contempla: *«cualquier especificidad del entorno
objetivo (balanceadores, proveedores terceros, ISP) debe resolverse entre el ASV
y el cliente del escaneo»*.

**Antes del primer escaneo hay que avisar a Netlify y a Supabase.** Escanear
infraestructura de un tercero sin avisar puede violar sus términos de servicio y
disparar sus propias defensas.

---

## 2. Cadencia

| | |
|---|---|
| **Frecuencia** | Al menos una vez **cada tres meses** (90 días) |
| **Quién** | Un **Approved Scanning Vendor** certificado por el PCI SSC |
| **Resultado exigido** | **Aprobatorio**. Un escaneo con hallazgos no cierra el requisito |
| **Reescaneo** | Obligatorio tras remediar, hasta obtener resultado aprobatorio |

### La concesión del primer año, que conviene conocer

El SAQ A dice, textualmente, que **para la certificación inicial no se requieren
cuatro escaneos aprobados en 12 meses** si el evaluador verifica:

1. que el resultado del escaneo **más reciente** fue aprobatorio,
2. que existen **políticas y procedimientos documentados** que exigen escanear
   al menos cada tres meses — este documento, y
3. que las vulnerabilidades del escaneo **se corrigieron**, demostrado en un
   reescaneo.

**A partir del segundo año sí se exigen los cuatro.** O sea que el calendario
real es: un escaneo aprobado antes de la auditoría, y desde entonces cuatro al
año sin saltarse ninguno.

---

## 3. Escaneo tras cambio significativo (11.3.2.1)

Distinto del trimestral, y con dos diferencias que importan:

- **El umbral es CVSS 4.0 o superior**, no solo alto/crítico.
- **NO exige ASV.** Textual del SAQ: *«los escaneos los realiza personal
  cualificado y existe independencia organizacional del evaluador (no se
  requiere que sea un QSA o ASV)»*.

O sea que este se puede hacer en casa. Lo que pide es competencia e
independencia: quien escanea no debería ser la misma persona que hizo el cambio.

### Qué cuenta como cambio significativo

PCI DSS no da una lista cerrada; la define la entidad y el evaluador la revisa.
Para ToursRed:

| Sí es cambio significativo | No lo es |
|---|---|
| Cambio de procesador de pagos, o alta de uno nuevo | Textos, precios, imágenes |
| Cambio en cómo se llega a la página de pago (redirección, dominio, flujo) | Una Edge Function de negocio que no toca el flujo de pago |
| Alta o baja de un subdominio público | Un cambio de estilos |
| Cambio de proveedor de hosting o de base de datos | Una migración que solo agrega una columna |
| Nuevo script de terceros cargado en el navegador | Actualizar una dependencia del front sin cambiar su origen |
| Cambio en la configuración de cabeceras HTTP o TLS | Cambios en el panel de administración interno |

**El criterio de fondo:** si el cambio puede alterar **cómo llega el navegador
del cliente a la página de pago**, o **qué se ejecuta en esa página**, es
significativo. Ese es el mismo criterio por el que la eliminación de
`/test-openpay-3ds` (PR #195) sí lo habría sido.

### Procedimiento

1. Quien aprueba el cambio marca en el PR si es significativo según la tabla.
2. Si lo es, se corre el escaneo externo **antes o inmediatamente después** del
   despliegue.
3. Se resuelve todo lo que puntúe **CVSS ≥ 4.0** y se reescanea.
4. Se archiva el reporte donde dice la sección 5.

---

## 4. Remediación

| Hallazgo | Plazo |
|---|---|
| Que impide un resultado aprobatorio del ASV | **Antes del cierre del trimestre**, sin excepción |
| CVSS ≥ 7.0 (alto o crítico) | 30 días |
| CVSS 4.0 – 6.9 | 90 días, o antes del siguiente escaneo trimestral |
| CVSS < 4.0 | Se registra; se remedia según criterio de negocio |

**Si un hallazgo no se puede remediar** —por ejemplo porque depende de Netlify o
Supabase— se documenta: qué es, por qué no se puede, qué mitiga el riesgo, y qué
se le pidió al proveedor. Un hallazgo abierto **documentado y escalado** es
defendible; uno abierto y en silencio, no.

---

## 5. Evidencia: qué se guarda y dónde

Lo que el evaluador va a pedir:

| Qué | Dónde |
|---|---|
| Reporte de cada escaneo ASV, incluidos los no aprobatorios | `docs/pci/escaneos/AAAA-TT-asv-<proveedor>.pdf` |
| Reporte de cada reescaneo | mismo lugar, sufijo `-rescan` |
| Reportes de escaneo por cambio significativo | `docs/pci/escaneos/AAAA-MM-DD-cambio-<descripcion>.pdf` |
| Esta política, con su historial de cambios | este archivo, en git |

**Se guardan también los escaneos que NO pasaron.** Es contraintuitivo y es
importante: la secuencia «falló → se remedió → reescaneo aprobado» es
exactamente la evidencia que pide la concesión del primer año. Un archivo donde
solo hay escaneos aprobados sugiere que se ocultaron los otros.

**Retención: 12 meses como mínimo**, y en la práctica indefinida — son PDFs, no
ocupan nada, y el historial es lo que demuestra continuidad.

---

## 6. Responsables

| Rol | Quién |
|---|---|
| Contratar y renovar el ASV | **Axel** |
| Correr el escaneo trimestral y archivar el reporte | por definir |
| Decidir si un cambio es significativo | quien aprueba el PR |
| Remediar hallazgos | el equipo técnico |
| Revisar que los cuatro trimestres se cumplieron | **Axel**, una vez al año |

Los nombres sin asignar están así **a propósito**: los pone Axel. Uno inventado
aquí sería peor que un hueco declarado.

---

## 7. Lo que esta política NO cubre

- **Pruebas de intrusión (11.4).** No se exigen en SAQ A. Si se hace un pentest
  interno es diligencia propia, no cumplimiento — ver
  [`escaneos-y-pruebas-de-intrusion.md`](escaneos-y-pruebas-de-intrusion.md).
- **Escaneos internos (11.3.1).** No están en SAQ A.
- **La contratación del ASV**, que es lo único de esta carpeta que no se puede
  resolver desde el repo.
