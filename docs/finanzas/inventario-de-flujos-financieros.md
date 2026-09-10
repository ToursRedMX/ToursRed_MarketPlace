# Inventario de flujos financieros

**Medición:** 10 de septiembre de 2026, contra producción
**Para qué:** insumo del reporte maestro (`/admin/reporte-maestro`), que hoy no
refleja la realidad. Antes de reescribirlo hay que saber qué flujos existen.

> Los montos son del sandbox de producción y sirven para dimensionar, no como
> cifras contables cerradas.

---

## 1. El modelo: tres capas, no una

Esta es la corrección de fondo, y viene de Axel:

> *"Las recargas del wallet, pues sí es un ingreso a bancos, pero realmente son
> un pasivo hasta que un viajero use ese dinero en alguna reserva y ahí sigue
> siendo un pasivo, solo cambia de cuenta porque ahora es dinero que se le debe
> a la agencia, y solo el porcentaje de comisión se convierte en activo."*

Eso no es un detalle del monedero: **es la estructura de casi todo el dinero que
toca ToursRed.** Un movimiento tiene que responder tres preguntas distintas, y
el reporte actual solo intenta una (mal):

| Capa | Pregunta | Ejemplo con un anticipo de $10,000 |
|---|---|---|
| **Caja** | ¿entró o salió dinero del banco? | +$10,000 |
| **Pasivo** | ¿de quién es ese dinero? | +$8,500 que se le deben a la agencia |
| **Ingreso** | ¿cuánto se ganó de verdad? | $1,500 de comisión + cargo por servicio |

Las tres son ciertas a la vez. Un log que sume solo la primera dice que ToursRed
facturó $10,000; uno que sume solo la tercera dice $1,500. **Ninguno de los dos
está bien solo**, y por eso el reporte tiene que llevar las tres columnas.

**El catálogo de cuentas ya modela esto**, lo cual confirma que el criterio es el
correcto y no un invento de este documento:

```
218-11  ToursRed Cash — Monedero de Clientes      (pasivo)
218-12  Tarjetas de Regalo Pendientes de Canje    (pasivo)
208     Anticipos de clientes                     (pasivo)
201.01  Aseguradoras                              (pasivo)
401     Ingresos por comisiones                   (ingreso)
402     Ingresos por cargo de servicio            (ingreso)
```

Con los datos reales al 10-sep-2026, las tres capas dan números muy distintos:

| | |
|---|---|
| Cobrado por procesadores | **$144,434.24** |
| Recargas de monedero | **$51,600.00** |
| Pasivo generado hacia agencias | **$95,189.74** |
| **Ingreso realmente reconocido** | **$47,547.47** |

Ese último número —comisión $35,017.51 + cargo por servicio $11,982.10 + los
opcionales y el plan de pagos— es lo que ToursRed ganó. El reporte maestro hoy
muestra **$335.00** para su ventana.

### La trampa de contar doble

El monedero obliga a marcar el origen de cada cobro:

- Recarga por SPEI: **+$51,600 de caja**, +$51,600 de pasivo. Nada de ingreso.
- Reserva pagada con monedero (**$11,861.16** en 4 reservas): **$0 de caja
  nueva**. El dinero ya había entrado en la recarga. Solo cambia el acreedor:
  baja el pasivo con el viajero, sube el pasivo con la agencia, y la comisión
  pasa a ingreso.

Si el log suma la recarga *y* la reserva, infla la caja en $11,861.16.

### Los reembolsos tampoco salen del banco

```
toursred_cash_transactions, type = 'refund'
  payment_plan_auto_cancel         +$11,988.04
  booking_cancellation              +$5,564.00
  booking_partial_cancellation      +$5,544.50
```

Un reembolso **se acredita al monedero**, no vuelve a la tarjeta. No es salida
de caja: es un pasivo que cambia de dueño. El efectivo solo sale si el viajero
retira. Marcarlos como "egreso" es el mismo error que el reporte actual, al revés.

---

## 2. Catálogo de ingresos

`C` = mueve caja · `P` = mueve pasivo · `I` = genera ingreso reconocido

| # | Concepto | Dónde vive | Filas | Monto | C | P | I |
|---|---|---|---:|---:|:-:|:-:|:-:|
| 1 | Anticipos de reserva | `payment_transactions` (`booking_deposit`) | 40 | $132,904.61 | ✅ | ✅ | ✅ |
| 2 | Recargas de monedero | `openpay_wallet_topups` | 3 | $51,600.00 | ✅ | ✅ | ❌ |
| 3 | Cuotas de plan de pagos | `payment_transactions` | 4 | $10,669.17 | ✅ | ✅ | ✅ |
| 4 | Seguro de viaje | `bookings.travel_insurance_cost` | 9 | $3,318.00 | ✅ | ✅ | ✅ |
| 5 | Tarjetas de regalo | `gift_cards` | 4 | $1,600.00 | ✅ | ✅ | ❌ |
| 6 | Servicios opcionales | `booking_optional_services` | 14 | $1,400.00 | ✅ | ✅ | ✅ |
| 7 | Membresías | `payment_transactions` (`membership`) | 1 | $860.46 | ✅ | ❌ | ✅ |
| 8 | Extra de idioma | `bookings.language_extra_cost` | — | $500.00 | ✅ | ✅ | ✅ |
| 9 | Extra de zona de pickup | `bookings.pickup_zone_extra_cost` | 0 | $0.00 | ✅ | ✅ | ✅ |
| 10 | Suplementos | `booking_supplements` | **0** | — | ✅ | ✅ | ✅ |
| 11 | Tours destacados | `featured_tour_slots` | **0** | — | ✅ | ❌ | ✅ |
| 12 | Comisión de aseguradora | `insurance_commission_receipts` | **0** | — | ✅ | ❌ | ✅ |
| 13 | Caducidad de tarjetas de regalo | *(cuenta `4090`)* | — | — | ❌ | ✅ | ✅ |
| 14 | Comisiones de mayorista | **no existe tabla** | — | — | ✅ | ❌ | ✅ |
| 15 | Tours/viajes a la medida | **no existe tabla** | — | — | ✅ | ❌ | ✅ |

**Nota sobre el 11 (tours destacados).** Según Axel es *"un servicio de promoción
que se le cobra a las agencias, ingreso 100% de ToursRed, otro flujo
completamente"*. Por eso no genera pasivo: no hay nada que liberar. Las tablas
(`featured_plans`, `featured_tour_slots`) existen y están completas, pero **el
catálogo de cuentas no tiene una cuenta de ingreso por promoción o publicidad**
— caería en `405 Otros ingresos`, que lo vuelve invisible.

**Nota sobre el 13.** Una tarjeta de regalo que caduca deja de ser pasivo y se
vuelve ingreso sin que entre un peso. La cuenta `4090` ya existe; nada la
alimenta todavía.

---

## 3. Catálogo de egresos

| # | Concepto | Dónde vive | Filas | Monto | Sale del banco |
|---|---|---:|---:|---|---|
| 1 | Liberaciones a agencias | `agency_payouts` | 3 | $121,205.31 | **Sí** |
| 2 | Reembolso por cancelación total | `booking_cancellations` | 7 | $11,988.04 | No — al monedero |
| 3 | Reembolso por cancelación parcial | `booking_partial_cancellations` | 1 | $5,544.50 | No — al monedero |
| 4 | Puntos otorgados | `toursred_points_transactions` | 42 | ≈$1,189.01 | No — pasivo |
| 5 | Comisiones de procesador | `payment_transactions.processor_fee` | — | $894.79 | **Sí** — subregistrado |
| 6 | Comisiones a ejecutivos | `executive_commissions` | 3 | $836.25 | **Sí** — solo $100 pagada |
| 7 | Cancelaciones por admin | `admin_booking_cancellations` | 4 | $0.00 | Depende |
| 8 | Exoneración de cargo por membresía | `bookings.membership_service_fee_saved` | — | $2,050.00 | No — ingreso no percibido |
| 9 | Liquidación a aseguradora | `insurance_settlements` | **0** | — | **Sí** |
| 10 | Contracargos por disputa | `payment_disputes` | **0** | — | **Sí** |
| 11 | Pagos a proveedores (Telcel, Claude, oficina) | **no existe tabla** | — | — | **Sí** |

---

## 4. Lo que no tiene dónde registrarse

Tres conceptos que Axel nombró **tienen cuenta contable pero no tienen tabla que
los capture.** No es que estén mal implementados: es que no se pueden registrar.

| Concepto | Cuenta que ya existe | Tabla |
|---|---|---|
| Comisiones de mayorista por tours internacionales | `407 Comisiones de mayoristas` | **ninguna** |
| Tours y viajes a la medida | `406` / `408` | **ninguna** |
| Gastos de operación | `601.01` servicios (internet, software, hosting)<br>`601.02` operativos (renta, papelería, luz)<br>`601.03` viáticos · `602` tecnología · `603` marketing | **ninguna** |

El catálogo de cuentas está bien pensado y se adelantó a esto. Lo que falta es
la captura. Hoy un pago a Telcel o a Anthropic **no puede entrar al sistema**, ni
siquiera a mano: `accounting_entries` solo tiene asientos generados por los nueve
`source_type` automáticos, no hay camino para un asiento manual.

**Consecuencia para el reporte maestro:** por completo que se haga, no va a poder
mostrar los gastos de operación hasta que exista dónde registrarlos. Es un
trabajo aparte —una pantalla de captura de gastos— y conviene decidirlo antes de
prometer un reporte "con absolutamente todos los egresos".

---

## 5. Tres defectos de datos encontrados de paso

**Comisiones de procesador subregistradas.** Conekta ($66,500 en 12 cobros) y
OpenPay ($11,706.84 en 4) reportan `processor_fee = 0.00`. Los dos cobran
comisión. Solo Stripe, PayPal y MercadoPago la llenan:

| Procesador | Bruto | Comisión registrada |
|---|---:|---:|
| Conekta | $66,500.00 | **$0.00** |
| Stripe | $25,327.38 | $284.24 |
| *(sin procesador)* | $21,560.78 | **$0.00** |
| OpenPay | $11,706.84 | **$0.00** |
| PayPal | $10,162.09 | $187.82 |
| MercadoPago | $9,177.15 | $422.73 |

El costo real de procesamiento es bastante mayor que los $894.79 registrados.

**Cuatro cobros por $21,560.78 sin procesador identificado** (`payment_processor`
en NULL). No se puede saber por dónde entró ese dinero ni conciliarlo contra
ningún estado de cuenta.

**`memberships.price_paid` está en $0.00** en sus dos filas, pero
`payment_transactions` tiene un cobro de membresía de $860.46. Una de las dos
miente.

---

## 6. Qué significa para el reporte maestro

1. **Tres columnas, no una:** caja, pasivo e ingreso reconocido. Un solo número
   no puede ser correcto para las tres preguntas.
2. **Marcar el origen del dinero** para no contar dos veces lo que pasa por el
   monedero.
3. **Los reembolsos al monedero no son egreso de caja.** Se muestran como cambio
   de pasivo.
4. **Incluir los conceptos con cero filas** (tours destacados, suplementos,
   comisión de aseguradora, disputas). Si el reporte solo consulta lo que hoy
   tiene datos, el día que se usen no aparecerán y nadie se va a enterar.
5. **La comisión de agencia va como línea informativa que no suma**, porque ya
   está dentro del anticipo cobrado. Sumarla sería contarla dos veces.
6. **Los gastos de operación quedan fuera hasta que exista captura**, y el
   reporte debe decirlo en pantalla en vez de dar a entender que están en cero.

---

## 7. Cómo regenerar este inventario

```sql
-- Ingresos por tipo de cobro
SELECT charge_context, status, count(*), round(sum(amount)::numeric,2)
FROM payment_transactions GROUP BY 1,2 ORDER BY 4 DESC;

-- Movimientos del monedero: separa dinero nuevo de dinero que solo cambia de mano
SELECT type::text, coalesce(reference_type,'—'), count(*), round(sum(amount)::numeric,2)
FROM toursred_cash_transactions GROUP BY 1,2 ORDER BY 4 DESC;

-- Ingreso realmente reconocido
SELECT round(sum(platform_total_revenue)::numeric,2) AS ingreso,
       round(sum(agency_net_amount)::numeric,2)      AS pasivo_a_agencias
FROM commission_records;

-- Comision de procesador por proveedor: delata a los que no la registran
SELECT coalesce(payment_processor,'(nulo)'), count(*),
       round(sum(amount)::numeric,2), round(sum(coalesce(processor_fee,0))::numeric,2)
FROM payment_transactions WHERE status='succeeded' GROUP BY 1 ORDER BY 3 DESC;

-- Que tablas de dinero tienen datos y cuales siguen vacias
SELECT source_type, count(*) FROM accounting_entries GROUP BY 1 ORDER BY 2 DESC;
```
