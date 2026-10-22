import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquare, RefreshCw, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { mensajeDeError } from '../../lib/errores';
import {
  estadoDeFila,
  etiquetaCanal,
  etiquetaProveedor,
  formatoMxn,
  formatoMxnUnitario,
  mesActualMx,
  periodoDeMes,
  puedeCerrarMes,
  totalesDelResumen,
  unidadDelCanal,
  type FilaResumen,
} from '../../lib/costosMensajeria';

interface Tarifa {
  proveedor: string;
  canal: string;
  incluidos_al_mes: number;
  costo_unitario_mxn: number;
  activo: boolean;
}

interface Edicion {
  incluidos: string;
  costo: string;
  activo: boolean;
}

const claveDe = (t: { proveedor: string; canal: string }) => `${t.proveedor}/${t.canal}`;

/**
 * Costos de mensajería: cuántos mensajes incluye cada proveedor al mes sin costo y cuánto cuesta cada uno después (en MXN y
 * sin IVA: son proveedores extranjeros sin CFDI), el consumo del mes y el cierre mensual, que deja un gasto en BORRADOR en la
 * cuenta 607 para revisarlo y registrarlo desde Gastos de Operación. El cálculo lo hace la base; aquí solo se muestra.
 */
const AdminCostosMensajeria: React.FC = () => {
  const { isSuperAdmin, permissions } = useAuth();
  const queryClient = useQueryClient();
  const puedeVer = isSuperAdmin || permissions?.canManageSettings;

  const [mes, setMes] = useState<string>(() => mesActualMx());
  const [ediciones, setEdiciones] = useState<Record<string, Edicion>>({});
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);

  const periodo = periodoDeMes(mes);

  const tarifasQuery = useQuery({
    queryKey: ['tarifas-mensajeria'],
    enabled: Boolean(puedeVer),
    queryFn: async (): Promise<Tarifa[]> => {
      const { data, error } = await supabase.rpc('get_tarifas_mensajeria');
      if (error) throw error;
      return ((data ?? []) as Tarifa[]).map((t) => ({ ...t, costo_unitario_mxn: Number(t.costo_unitario_mxn) }));
    },
  });

  const resumenQuery = useQuery({
    queryKey: ['resumen-costos-mensajeria', mes],
    enabled: Boolean(puedeVer) && periodo !== null,
    queryFn: async (): Promise<FilaResumen[]> => {
      const { data, error } = await supabase.rpc('resumen_costos_mensajeria', { p_anio: periodo!.anio, p_mes: periodo!.mes });
      if (error) throw error;
      return ((data ?? []) as FilaResumen[]).map((f) => ({
        ...f,
        usados: Number(f.usados),
        excedente: Number(f.excedente),
        costo_unitario_mxn: Number(f.costo_unitario_mxn),
        costo_mxn: Number(f.costo_mxn),
      }));
    },
  });

  const guardar = useMutation({
    mutationFn: async (t: Tarifa) => {
      const e = ediciones[claveDe(t)];
      const { error } = await supabase.rpc('guardar_tarifa_mensajeria', {
        p_proveedor: t.proveedor,
        p_canal: t.canal,
        p_incluidos: Number(e?.incluidos ?? t.incluidos_al_mes),
        p_costo: Number(e?.costo ?? t.costo_unitario_mxn),
        p_activo: e?.activo ?? t.activo,
      });
      if (error) throw error;
      return claveDe(t);
    },
    onSuccess: (clave) => {
      setEdiciones((prev) => {
        const { [clave]: _quitada, ...resto } = prev;
        return resto;
      });
      setAviso({ tipo: 'ok', texto: 'Tarifa guardada.' });
      void queryClient.invalidateQueries({ queryKey: ['tarifas-mensajeria'] });
      void queryClient.invalidateQueries({ queryKey: ['resumen-costos-mensajeria'] });
    },
    onError: (e) => setAviso({ tipo: 'error', texto: mensajeDeError(e) || 'No se pudo guardar la tarifa.' }),
  });

  const cerrar = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('cerrar_costos_mensajeria', { p_anio: periodo!.anio, p_mes: periodo!.mes });
      if (error) throw error;
      return Number(data ?? 0);
    },
    onSuccess: (creados) => {
      setAviso({
        tipo: 'ok',
        texto: creados > 0
          ? `Mes cerrado: se crearon ${creados} gasto${creados === 1 ? '' : 's'} en borrador. Revísalos y regístralos en Gastos de Operación.`
          : 'Mes cerrado sin costo: ningún proveedor pasó de lo incluido (o su tarifa está en cero).',
      });
      void queryClient.invalidateQueries({ queryKey: ['resumen-costos-mensajeria'] });
    },
    onError: (e) => setAviso({ tipo: 'error', texto: mensajeDeError(e) || 'No se pudo cerrar el mes.' }),
  });

  if (!puedeVer) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="bg-white rounded-lg shadow-lg p-8 max-w-md w-full text-center">
          <AlertTriangle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Acceso Denegado</h2>
          <p className="text-gray-600">No tienes permiso para ver los costos de mensajería.</p>
        </div>
      </div>
    );
  }

  const tarifas = tarifasQuery.data ?? [];
  const filas = resumenQuery.data ?? [];
  const totales = totalesDelResumen(filas);
  const cerrable = periodo !== null && puedeCerrarMes(filas, periodo.anio, periodo.mes);
  const hayGastos = filas.some((f) => f.gasto_id);

  const valorDe = (t: Tarifa): Edicion => ediciones[claveDe(t)] ?? {
    incluidos: String(t.incluidos_al_mes),
    costo: String(t.costo_unitario_mxn),
    activo: t.activo,
  };
  const cambiar = (t: Tarifa, parcial: Partial<Edicion>) =>
    setEdiciones((prev) => ({ ...prev, [claveDe(t)]: { ...valorDe(t), ...parcial } }));
  const modificada = (t: Tarifa) => claveDe(t) in ediciones;

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-slate-800 rounded-lg flex items-center justify-center">
              <MessageSquare className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Costos de mensajería</h1>
              <p className="text-sm text-gray-500">
                SMS, WhatsApp y correo · en MXN y sin IVA (proveedores extranjeros, sin CFDI) · cuenta 607
              </p>
            </div>
          </div>
          <button
            onClick={() => {
              void tarifasQuery.refetch();
              void resumenQuery.refetch();
            }}
            className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-700 hover:bg-gray-50 transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${resumenQuery.isFetching || tarifasQuery.isFetching ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
        </div>

        {aviso && (
          <div
            role={aviso.tipo === 'error' ? 'alert' : 'status'}
            className={`rounded-lg p-3 text-sm ${aviso.tipo === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}
          >
            {aviso.texto}
          </div>
        )}

        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-900">Tarifas por proveedor</h2>
          <p className="text-sm text-gray-600 mt-1">
            Cuántos mensajes incluye cada proveedor al mes sin costo y cuánto cuesta cada uno después. Una tarifa en cero no
            genera gasto. Cambiarla no reescribe los meses ya cerrados.
          </p>
          {tarifasQuery.isError && <p role="alert" className="mt-3 text-sm text-red-600">No se pudieron leer las tarifas.</p>}
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200">
                  <th className="py-2 pr-3 font-medium">Proveedor</th>
                  <th className="py-2 pr-3 font-medium">Canal</th>
                  <th className="py-2 pr-3 font-medium">Incluidos al mes</th>
                  <th className="py-2 pr-3 font-medium">Costo por unidad (MXN)</th>
                  <th className="py-2 pr-3 font-medium">Activa</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {tarifas.map((t) => {
                  const v = valorDe(t);
                  return (
                    <tr key={claveDe(t)} className="border-b border-gray-100">
                      <td className="py-2 pr-3 font-medium text-gray-900">{etiquetaProveedor(t.proveedor)}</td>
                      <td className="py-2 pr-3 text-gray-700">
                        {etiquetaCanal(t.canal)} <span className="text-gray-400">({unidadDelCanal(t.canal)})</span>
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={v.incluidos}
                          onChange={(e) => cambiar(t, { incluidos: e.target.value })}
                          aria-label={`Incluidos al mes de ${etiquetaProveedor(t.proveedor)} ${etiquetaCanal(t.canal)}`}
                          className="w-32 rounded-md border border-gray-300 px-2 py-1"
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          type="number"
                          min={0}
                          step="0.0001"
                          value={v.costo}
                          onChange={(e) => cambiar(t, { costo: e.target.value })}
                          aria-label={`Costo por unidad de ${etiquetaProveedor(t.proveedor)} ${etiquetaCanal(t.canal)}`}
                          className="w-32 rounded-md border border-gray-300 px-2 py-1"
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          type="checkbox"
                          checked={v.activo}
                          onChange={(e) => cambiar(t, { activo: e.target.checked })}
                          aria-label={`Tarifa activa de ${etiquetaProveedor(t.proveedor)} ${etiquetaCanal(t.canal)}`}
                        />
                      </td>
                      <td className="py-2 text-right">
                        <button
                          onClick={() => guardar.mutate(t)}
                          disabled={!modificada(t) || guardar.isPending}
                          className="px-3 py-1 rounded-md bg-slate-800 text-white text-xs disabled:opacity-40"
                        >
                          Guardar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-semibold text-gray-900">Consumo y costo del mes</h2>
              <p className="text-sm text-gray-600 mt-1">
                Estimación con la tarifa configurada, no la factura del proveedor. Un SMS largo cuenta por segmento. El correo
                se cuenta desde el 19-oct-2026, cuando empezó la bitácora.
              </p>
            </div>
            <label className="text-sm text-gray-700">
              Mes{' '}
              <input
                type="month"
                value={mes}
                max={mesActualMx()}
                onChange={(e) => {
                  setAviso(null);
                  setMes(e.target.value);
                }}
                className="ml-1 rounded-md border border-gray-300 px-2 py-1"
              />
            </label>
          </div>

          {periodo === null && <p role="alert" className="mt-3 text-sm text-red-600">Elige un mes válido.</p>}
          {resumenQuery.isError && <p role="alert" className="mt-3 text-sm text-red-600">No se pudo leer el consumo del mes.</p>}

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-200">
                  <th className="py-2 pr-3 font-medium">Proveedor</th>
                  <th className="py-2 pr-3 font-medium">Canal</th>
                  <th className="py-2 pr-3 font-medium text-right">Usados</th>
                  <th className="py-2 pr-3 font-medium text-right">Incluidos</th>
                  <th className="py-2 pr-3 font-medium text-right">Excedente</th>
                  <th className="py-2 pr-3 font-medium text-right">Tarifa</th>
                  <th className="py-2 pr-3 font-medium text-right">Costo</th>
                  <th className="py-2 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={`${f.proveedor}/${f.canal}`} className="border-b border-gray-100">
                    <td className="py-2 pr-3 font-medium text-gray-900">{etiquetaProveedor(f.proveedor)}</td>
                    <td className="py-2 pr-3 text-gray-700">{etiquetaCanal(f.canal)}</td>
                    <td className="py-2 pr-3 text-right">{f.usados.toLocaleString()}</td>
                    <td className="py-2 pr-3 text-right">{f.incluidos.toLocaleString()}</td>
                    <td className="py-2 pr-3 text-right">{f.excedente.toLocaleString()}</td>
                    <td className="py-2 pr-3 text-right">{formatoMxnUnitario(f.costo_unitario_mxn)}</td>
                    <td className="py-2 pr-3 text-right font-medium">{formatoMxn(f.costo_mxn)}</td>
                    <td className="py-2 text-gray-600">{estadoDeFila(f)}</td>
                  </tr>
                ))}
                {filas.length > 0 && (
                  <tr className="font-semibold text-gray-900">
                    <td className="py-2 pr-3" colSpan={2}>Total del mes</td>
                    <td className="py-2 pr-3 text-right">{totales.usados.toLocaleString()}</td>
                    <td colSpan={3} />
                    <td className="py-2 pr-3 text-right">{formatoMxn(totales.costo)}</td>
                    <td />
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {cerrable && (
              <button
                onClick={() => {
                  if (confirm(`¿Cerrar ${mes}? Se crea un gasto en borrador por cada proveedor con costo. Un mes cerrado queda congelado.`)) {
                    setAviso(null);
                    cerrar.mutate();
                  }
                }}
                disabled={cerrar.isPending}
                className="px-4 py-2 rounded-lg bg-slate-800 text-white text-sm disabled:opacity-40"
              >
                Cerrar mes
              </button>
            )}
            {hayGastos && (
              <Link to="/admin/gastos" className="text-sm text-slate-700 underline">
                Ver los gastos en Gastos de Operación
              </Link>
            )}
            <span className="text-xs text-gray-500">
              El cierre corre solo el día 1 de cada mes y deja los gastos en borrador; nunca los registra por su cuenta.
            </span>
          </div>
        </section>
      </div>
    </div>
  );
};

export default AdminCostosMensajeria;
