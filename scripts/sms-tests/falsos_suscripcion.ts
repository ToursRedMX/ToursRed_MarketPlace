import { procesarEventoNotificaciones } from '../../supabase/functions/_shared/suscripcionNotificaciones.ts';

// Dobles de prueba de la suscripcion de notificaciones: un cliente de Supabase de mentira que anota que se le pidio, y las
// dependencias que stripe-webhook inyecta. Cada consulta devuelve la respuesta de su tabla y registra el encadenado.
// `cola` permite respuestas distintas para llamadas sucesivas a la misma tabla; `insercion` es la respuesta si la cadena fue un insert.
export type Respuesta = { data?: unknown; error?: { message: string; code?: string } | null };
export type Llamada = { tabla: string; ops: string[] };
export type Rpc = { nombre: string; args: unknown };

export function falso(respuestas: Record<string, Respuesta & { cola?: Respuesta[]; insercion?: Respuesta }> = {}, rpcRespuesta: Respuesta = {}) {
  const llamadas: Llamada[] = [];
  const rpcs: Rpc[] = [];
  const orden: string[] = [];
  const cliente = {
    from(tabla: string) {
      const llamada: Llamada = { tabla, ops: [] };
      llamadas.push(llamada);
      const config = respuestas[tabla] ?? {};
      const resolver = (): Respuesta => {
        const esInsert = llamada.ops.some((o) => o.startsWith('insert'));
        const base = esInsert && config.insercion ? config.insercion : (config.cola?.shift() ?? config);
        return { data: null, error: null, ...base };
      };
      const q: Record<string, unknown> = {};
      for (const op of ['select', 'update', 'upsert', 'insert', 'eq', 'neq', 'is', 'in', 'not', 'order', 'limit']) {
        q[op] = (...args: unknown[]) => {
          llamada.ops.push(`${op}(${args.map((a) => JSON.stringify(a)).join(',')})`);
          if (op === 'insert' || op === 'update' || op === 'upsert') orden.push(`${op}:${tabla}`);
          return q;
        };
      }
      q.maybeSingle = () => { llamada.ops.push('maybeSingle'); return Promise.resolve(resolver()); };
      q.single = () => { llamada.ops.push('single'); return Promise.resolve(resolver()); };
      q.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(resolver()).then(ok, ko);
      return q;
    },
    rpc(nombre: string, args: unknown) {
      rpcs.push({ nombre, args });
      orden.push(`rpc:${nombre}`);
      return Promise.resolve({ data: null, error: null, ...rpcRespuesta });
    },
  };
  return { cliente: cliente as never, llamadas, rpcs, orden };
}

type Comision = { fee: number; net: number; base: number | null; iva: number | null };

/** Las dependencias que stripe-webhook inyecta, anotando como se usaron. */
export function dependencias(opciones: { comision?: Comision | null } = {}) {
  const registro = { fallos: [] as string[], comisiones: [] as string[], funciones: [] as { nombre: string; cuerpo: Record<string, unknown> }[], segundoPlano: 0 };
  const deps = {
    comisionDePago: (_stripe: unknown, pi: string) => {
      registro.comisiones.push(pi);
      return Promise.resolve(opciones.comision === undefined ? { fee: 5, net: 84, base: 4.31, iva: 0.69 } : opciones.comision);
    },
    columnasDeComision: (c: Comision) => ({ processor_fee: c.fee, net_amount: c.net }),
    registrarFallo: (contexto: string) => { registro.fallos.push(contexto); return Promise.resolve(); },
    invocarFuncion: (nombre: string, cuerpo: Record<string, unknown>) => { registro.funciones.push({ nombre, cuerpo }); return Promise.resolve(); },
    enSegundoPlano: (_t: Promise<unknown>) => { registro.segundoPlano++; },
  };
  return { deps: deps as never, registro };
}

export const depsInertes = () => dependencias().deps;
export const procesar = (cliente: never, stripe: never, evento: never) => procesarEventoNotificaciones(cliente, stripe, evento, depsInertes());
export const stripeSinRed = { subscriptions: { retrieve: () => { throw new Error('no debe llamar a Stripe'); } } } as never;
export const MARCA = { tipo_suscripcion: 'notificaciones', sujeto: 'viajero', notif_user_id: 'u-1' };
