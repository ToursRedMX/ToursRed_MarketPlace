/**
 * Promociones de grupo de un tour.
 *
 * ============================================================================
 * QUE RESUELVE
 * ============================================================================
 *
 * `get_active_promotion_for_tour` devuelve la promocion VIGENTE del tour —ya
 * filtra `is_active`, las fechas y los usos agotados, y devuelve como mucho
 * una—. Lo que NO hace es decir cuanto se descuenta: eso depende de cuantos
 * viajeros van y de que precio tiene cada categoria, y lo calcula el front.
 *
 * Son CUATRO tipos, cada uno con su aritmetica, y los nombres enganan:
 *
 *   `2x1` / `3x2`        -- viajeros gratis. De cada `group_size` se pagan
 *                           `pay_count`; el resto sale gratis al precio de
 *                           ADULTO, sea cual sea la categoria del que sobra.
 *
 *   `nxprecio`           -- «N por $X». Usa `fixed_group_price`. El descuento
 *                           es lo que el grupo costaria menos ese precio fijo.
 *
 *   `grupo_precio_fijo`  -- pese al nombre, es un PORCENTAJE
 *                           (`group_discount_percentage`) sobre cada viajero,
 *                           con el precio de SU categoria.
 *
 * Los dos ultimos tienen el nombre cambiado respecto a lo que hacen: el que se
 * llama «precio fijo» aplica un porcentaje, y el que aplica un precio fijo se
 * llama «nxprecio». Se conservan porque son los valores que ya escribe
 * `AdminPromotions` y que estan en la base; renombrarlos es una migracion, no
 * una correccion.
 *
 * ----------------------------------------------------------------------------
 * LAS MASCOTAS NO CUENTAN
 * ----------------------------------------------------------------------------
 *
 * El total que decide si la promocion se activa —y cuantos grupos salen— son
 * los viajeros HUMANOS. Una reserva de 3 adultos y 2 perros no es un grupo de
 * 5 para un 3x2.
 *
 * ----------------------------------------------------------------------------
 * `max_uses` TOPA LOS GRUPOS DENTRO DE UNA MISMA RESERVA
 * ----------------------------------------------------------------------------
 *
 * Es la parte que se olvida. La RPC ya descarta la promocion si los usos estan
 * agotados, pero en `nxprecio` una sola reserva puede consumir VARIOS usos: 12
 * viajeros con `min_travelers = 4` son tres grupos. Si solo quedan dos usos,
 * dos grupos llevan promocion y el tercero paga completo. Sin ese tope, una
 * reserva grande se lleva mas descuento del que la promocion autorizaba.
 */

export interface PromocionDeGrupo {
  id: string;
  promotion_type: string;
  min_travelers: number;
  group_size: number;
  pay_count: number;
  fixed_group_price: number | null;
  group_discount_percentage: number | null;
  max_uses: number | null;
  times_used: number;
}

export interface ViajerosPorCategoria {
  adultos: number;
  ninos: number;
  infantes: number;
  adultos_mayores: number;
  mascotas: number;
}

export interface PreciosPorCategoria {
  adulto: number;
  nino: number;
  infante: number;
  adulto_mayor: number;
}

export interface ResultadoDePromocion {
  /** Lo que se resta al precio del tour. Nunca negativo. */
  descuento: number;
  activa: boolean;
  /** Que decirle al viajero cuando SI aplica. */
  etiqueta: string;
  /** Que decirle cuando le faltan poquitos viajeros para activarla. */
  mensajeCasiLoLogras: string | null;
  /** Aviso de usos restantes, solo en `nxprecio` con `max_uses`. */
  notaDeDisponibilidad: string | null;
}

const SIN_PROMOCION: ResultadoDePromocion = {
  descuento: 0, activa: false, etiqueta: '',
  mensajeCasiLoLogras: null, notaDeDisponibilidad: null,
};

const redondear = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const plural = (n: number) => (n > 1 ? 's' : '');
const pesos = (n: number) =>
  n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Viajeros que cuentan para un grupo: los humanos. */
export function humanos(v: ViajerosPorCategoria): number {
  return v.adultos + v.ninos + v.infantes + v.adultos_mayores;
}

export function calcularPromocionDeGrupo(
  promocion: PromocionDeGrupo | null | undefined,
  viajeros: ViajerosPorCategoria,
  precios: PreciosPorCategoria,
): ResultadoDePromocion {
  if (!promocion) return SIN_PROMOCION;

  const total = humanos(viajeros);
  const {
    promotion_type, min_travelers, group_size, pay_count,
    fixed_group_price, group_discount_percentage, max_uses, times_used,
  } = promocion;

  // ---------------------------------------------------------------- N x $X
  if (promotion_type === 'nxprecio') {
    if (total < min_travelers) {
      const faltan = min_travelers - total;
      return faltan <= 2
        ? { ...SIN_PROMOCION, mensajeCasiLoLogras:
            `Agrega ${faltan} viajero${plural(faltan)} mas para activar el precio especial grupal.` }
        : SIN_PROMOCION;
    }
    if (fixed_group_price === null) return SIN_PROMOCION;

    const grupos = Math.floor(total / min_travelers);
    const sobran = total % min_travelers;

    // El tope de usos aplica DENTRO de esta reserva.
    const usosRestantes = max_uses !== null ? Math.max(0, max_uses - times_used) : Infinity;
    const gruposConPromo = Math.min(grupos, usosRestantes === Infinity ? grupos : usosRestantes);
    const gruposSinPromo = grupos - gruposConPromo;

    const precioNormalDelGrupo = min_travelers * precios.adulto;
    const descuentoPorGrupo = Math.max(0, precioNormalDelGrupo - fixed_group_price);
    const descuento = redondear(gruposConPromo * descuentoPorGrupo);

    if (descuento <= 0) return SIN_PROMOCION;

    let etiqueta = `${min_travelers} x $${pesos(fixed_group_price)} — ${gruposConPromo} grupo${plural(gruposConPromo)} con precio especial`;
    if (gruposSinPromo > 0) {
      const n = gruposSinPromo * min_travelers;
      etiqueta += ` (${n} viajero${plural(n)} a precio normal)`;
    }
    if (sobran > 0) {
      etiqueta += ` + ${sobran} viajero${plural(sobran)} a precio normal`;
    }

    let notaDeDisponibilidad: string | null = null;
    if (max_uses !== null) {
      const quedan = Math.max(0, max_uses - times_used - gruposConPromo);
      notaDeDisponibilidad = quedan > 0
        ? `Sujeto a disponibilidad — quedan ${quedan} uso${plural(quedan)} tras esta reserva`
        : 'Sujeto a disponibilidad — esta reserva agota los usos disponibles';
    }

    return { descuento, activa: true, etiqueta, mensajeCasiLoLogras: null, notaDeDisponibilidad };
  }

  // ------------------------------------------------- Precio Grupal (un %)
  if (promotion_type === 'grupo_precio_fijo') {
    if (total >= min_travelers && group_discount_percentage !== null && group_discount_percentage > 0) {
      const pct = group_discount_percentage / 100;
      const descuento = redondear(
        precios.adulto * viajeros.adultos * pct
        + precios.nino * viajeros.ninos * pct
        + precios.infante * viajeros.infantes * pct
        + precios.adulto_mayor * viajeros.adultos_mayores * pct,
      );
      return {
        descuento,
        activa: descuento > 0,
        etiqueta: `Precio Grupal ${group_discount_percentage}% desc. por persona (${min_travelers}+ viajeros)`,
        mensajeCasiLoLogras: null,
        notaDeDisponibilidad: null,
      };
    }
    const faltan = min_travelers - total;
    return faltan > 0 && faltan <= 3
      ? { ...SIN_PROMOCION, mensajeCasiLoLogras:
          `Agrega ${faltan} viajero${plural(faltan)} mas y activa el descuento grupal de ${group_discount_percentage}%.` }
      : SIN_PROMOCION;
  }

  // ------------------------------------------------------------ 2x1 / 3x2
  if (promotion_type === '2x1' || promotion_type === '3x2') {
    if (total < min_travelers) {
      const faltan = min_travelers - total;
      return faltan <= 2
        ? { ...SIN_PROMOCION, mensajeCasiLoLogras:
            `Agrega ${faltan} viajero${plural(faltan)} mas y activa el ${promotion_type}.` }
        : SIN_PROMOCION;
    }
    // `group_size >= 2` y `pay_count >= 1` por CHECK, asi que `gratisPorGrupo`
    // no puede ser negativo — pero si `pay_count >= group_size` seria cero, y
    // entonces no hay promocion que aplicar.
    const gratisPorGrupo = group_size - pay_count;
    if (gratisPorGrupo <= 0) return SIN_PROMOCION;

    const gruposCompletos = Math.floor(total / group_size);
    const gratis = gruposCompletos * gratisPorGrupo;
    const descuento = redondear(gratis * precios.adulto);

    return {
      descuento,
      activa: descuento > 0,
      etiqueta: `Promocion ${promotion_type} — ${gratis} viajero${plural(gratis)} gratis`,
      mensajeCasiLoLogras: null,
      notaDeDisponibilidad: null,
    };
  }

  // Un tipo que no conocemos no descuenta nada. Inventar un importe sobre una
  // promocion que no se entiende es peor que ignorarla.
  return SIN_PROMOCION;
}
