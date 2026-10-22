// Lógica de la pantalla «Costos de mensajería» del admin (src/pages/admin/AdminCostosMensajeria.tsx): etiquetas, unidades,
// formato de dinero y las reglas de mes que decide la pantalla. Aquí viven para poder probarlas sin la pantalla.
//
// El cálculo del costo NO se repite aquí: lo hace la base (`resumen_costos_mensajeria` y `cerrar_costos_mensajeria`) y la
// pantalla solo lo muestra. Lo que sí vive aquí son las reglas de presentación.

export type CanalMensajeria = 'sms' | 'whatsapp' | 'email';

export const ETIQUETAS_PROVEEDOR: Record<string, string> = {
  twilio: 'Twilio',
  labsmobile: 'LabsMobile',
  smtp2go: 'SMTP2GO',
  sendgrid: 'SendGrid',
  zoho: 'Zoho Mail',
};

export const ETIQUETAS_CANAL: Record<string, string> = {
  sms: 'SMS',
  whatsapp: 'WhatsApp',
  email: 'Correo',
};

/** Lo que se cuenta en cada canal: un SMS largo son varios segmentos y se cobra por segmento. */
export const UNIDADES_CANAL: Record<string, string> = {
  sms: 'segmento',
  whatsapp: 'mensaje',
  email: 'correo',
};

export const etiquetaProveedor = (p: string): string => ETIQUETAS_PROVEEDOR[p] ?? p;
export const etiquetaCanal = (c: string): string => ETIQUETAS_CANAL[c] ?? c;
export const unidadDelCanal = (c: string): string => UNIDADES_CANAL[c] ?? 'mensaje';

const MXN = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MXN_UNITARIO = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2, maximumFractionDigits: 4 });

/** $1,234.50 — dos decimales, para totales. */
export const formatoMxn = (n: number): string => MXN.format(Number.isFinite(n) ? n : 0);
/** $0.0750 — hasta cuatro decimales, para el costo de UN mensaje (suele ser de centavos). */
export const formatoMxnUnitario = (n: number): string => MXN_UNITARIO.format(Number.isFinite(n) ? n : 0);

const ZONA = 'America/Mexico_City';

/** El mes de hoy en hora de Ciudad de México, como `yyyy-mm` (lo que entiende <input type="month">). */
export function mesActualMx(ahora: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit' }).formatToParts(ahora);
  const anio = partes.find((p) => p.type === 'year')?.value;
  const mes = partes.find((p) => p.type === 'month')?.value;
  return `${anio}-${mes}`;
}

/** `yyyy-mm` -> { anio, mes }, o null si no es un mes válido (la base rechaza lo que no esté entre 2020 y 2100). */
export function periodoDeMes(valor: string): { anio: number; mes: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(valor);
  if (!m) return null;
  const anio = Number(m[1]);
  const mes = Number(m[2]);
  return anio >= 2020 && anio <= 2100 && mes >= 1 && mes <= 12 ? { anio, mes } : null;
}

/** Un mes se puede cerrar solo cuando YA terminó (la base lo exige igual): es anterior al mes de hoy en México. */
export function mesTerminado(anio: number, mes: number, ahora: Date = new Date()): boolean {
  const hoy = periodoDeMes(mesActualMx(ahora));
  if (!hoy) return false;
  return anio < hoy.anio || (anio === hoy.anio && mes < hoy.mes);
}

export interface FilaResumen {
  proveedor: string;
  canal: string;
  usados: number;
  incluidos: number;
  excedente: number;
  costo_unitario_mxn: number;
  costo_mxn: number;
  cerrado: boolean;
  gasto_id: string | null;
  gasto_estado: string | null;
}

export function totalesDelResumen(filas: FilaResumen[]): { usados: number; costo: number } {
  return filas.reduce(
    (acc, f) => ({ usados: acc.usados + Number(f.usados), costo: acc.costo + Number(f.costo_mxn) }),
    { usados: 0, costo: 0 },
  );
}

/** El botón «Cerrar mes» solo aparece en un mes terminado donde aún quede algún proveedor sin cerrar. */
export function puedeCerrarMes(filas: FilaResumen[], anio: number, mes: number, ahora: Date = new Date()): boolean {
  return mesTerminado(anio, mes, ahora) && filas.some((f) => !f.cerrado);
}

/** Texto del estado de una fila: estimado en vivo, o cerrado con el estado de su gasto. */
export function estadoDeFila(f: Pick<FilaResumen, 'cerrado' | 'gasto_id' | 'gasto_estado' | 'costo_mxn'>): string {
  if (!f.cerrado) return 'Estimado (mes en curso o sin cerrar)';
  if (!f.gasto_id) return Number(f.costo_mxn) > 0 ? 'Cerrado (gasto eliminado)' : 'Cerrado · sin costo';
  if (f.gasto_estado === 'registrado') return 'Cerrado · gasto registrado';
  if (f.gasto_estado === 'cancelado') return 'Cerrado · gasto cancelado';
  return 'Cerrado · gasto en borrador';
}
