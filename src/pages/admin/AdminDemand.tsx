import React, { useEffect, useState } from 'react';
import { Download, Search, SearchX, ShieldAlert, TrendingDown, TrendingUp, X } from 'lucide-react';
import { format } from 'date-fns';
import { supabase } from '../../lib/supabase';
import { downloadExcel } from '../../utils/excelExport';

/**
 * Demanda de viajeros, vista de superadmin: sin umbral y con el detalle de quien
 * busco (nombre y correo cuando hubo sesion iniciada y consentimiento de
 * analitica). Datos de `admin_demand_terms` y `admin_demand_searches`
 * (migracion 20261003000000); ambas rechazan a quien no sea superadmin.
 */

interface TerminoAdmin {
  termino: string;
  llave: string;
  busquedas: number;
  busquedas_sin_resultados: number;
  sesiones: number;
  usuarios_identificados: number;
  busquedas_periodo_anterior: number;
  tours_coincidentes: number;
  agencias_coincidentes: number;
}

interface BusquedaAdmin {
  creada_en: string;
  texto_buscado: string;
  resultados: number | null;
  user_id: string | null;
  nombre: string | null;
  email: string | null;
  dispositivo: string | null;
  origen: string | null;
}

const PERIODOS = [7, 30, 90];

function Tendencia({ actual, anterior }: { actual: number; anterior: number }) {
  if (anterior === 0) return <span className="text-xs text-gray-400">nuevo</span>;
  const cambio = Math.round(((actual - anterior) / anterior) * 100);
  if (cambio === 0) return <span className="text-xs text-gray-400">igual</span>;
  const sube = cambio > 0;
  const Icono = sube ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${sube ? 'text-green-700' : 'text-red-600'}`}>
      <Icono className="w-3 h-3" />
      {sube ? '+' : ''}{cambio}%
    </span>
  );
}

const AdminDemand: React.FC = () => {
  const [dias, setDias] = useState(30);
  const [soloSin, setSoloSin] = useState(false);
  const [terminos, setTerminos] = useState<{
    clave: string; error: string | null; filas: TerminoAdmin[];
  } | null>(null);
  const [seleccion, setSeleccion] = useState<TerminoAdmin | null>(null);
  const [detalle, setDetalle] = useState<{
    clave: string; error: string | null; filas: BusquedaAdmin[];
  } | null>(null);

  const claveTerminos = `${dias}|${soloSin}`;
  const claveDetalle = seleccion ? `${seleccion.llave}|${Math.max(dias, 90)}` : '';

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const { data, error } = await supabase.rpc('admin_demand_terms', {
        p_days: dias, p_solo_sin_resultados: soloSin, p_limit: 200,
      });
      if (cancelado) return;
      if (error) {
        console.error('AdminDemand: no se pudieron cargar los terminos', error);
        setTerminos({ clave: claveTerminos, error: 'No se pudo cargar el reporte (¿eres superadministrador?).', filas: [] });
        return;
      }
      setTerminos({ clave: claveTerminos, error: null, filas: (data as TerminoAdmin[] | null) ?? [] });
    })();
    return () => { cancelado = true; };
  }, [dias, soloSin, claveTerminos]);

  useEffect(() => {
    if (!seleccion) return;
    let cancelado = false;
    (async () => {
      const { data, error } = await supabase.rpc('admin_demand_searches', {
        p_llave: seleccion.llave, p_days: Math.max(dias, 90), p_limit: 500,
      });
      if (cancelado) return;
      if (error) {
        console.error('AdminDemand: no se pudo cargar el detalle', error);
        setDetalle({ clave: claveDetalle, error: 'No se pudo cargar el detalle de este término.', filas: [] });
        return;
      }
      setDetalle({ clave: claveDetalle, error: null, filas: (data as BusquedaAdmin[] | null) ?? [] });
    })();
    return () => { cancelado = true; };
  }, [seleccion, dias, claveDetalle]);

  const cargandoTerminos = terminos?.clave !== claveTerminos;
  const cargandoDetalle = !!seleccion && detalle?.clave !== claveDetalle;
  const filas = cargandoTerminos ? [] : terminos?.filas ?? [];
  const detalleFilas = cargandoDetalle ? [] : detalle?.filas ?? [];

  const personas = new Map<string, BusquedaAdmin>();
  for (const b of detalleFilas) {
    if (b.user_id && b.email && !personas.has(b.user_id)) personas.set(b.user_id, b);
  }

  const descargarTerminos = async () => {
    await downloadExcel(
      [{
        sheet: 'Demanda',
        data: [
          ['Búsqueda', 'Veces', 'Sin resultados', 'Sesiones', 'Usuarios identificados', 'Periodo anterior', 'Tours que coinciden', 'Agencias que coinciden'],
          ...filas.map((t) => [
            t.termino, t.busquedas, t.busquedas_sin_resultados, t.sesiones, t.usuarios_identificados,
            t.busquedas_periodo_anterior, t.tours_coincidentes, t.agencias_coincidentes,
          ]),
        ],
        columns: [{ width: 28 }, { width: 10 }, { width: 14 }, { width: 10 }, { width: 20 }, { width: 16 }, { width: 18 }, { width: 20 }],
      }],
      `demanda-admin-${dias}-dias.xlsx`,
    );
  };

  const descargarDetalle = async () => {
    if (!seleccion) return;
    await downloadExcel(
      [{
        sheet: 'Búsquedas',
        data: [
          ['Fecha', 'Texto buscado', 'Resultados', 'Nombre', 'Correo', 'Dispositivo', 'Origen'],
          ...detalleFilas.map((b) => [
            format(new Date(b.creada_en), 'yyyy-MM-dd HH:mm'), b.texto_buscado, b.resultados ?? '',
            b.nombre ?? '', b.email ?? '', b.dispositivo ?? '', b.origen ?? '',
          ]),
        ],
        columns: [{ width: 18 }, { width: 26 }, { width: 12 }, { width: 24 }, { width: 30 }, { width: 14 }, { width: 18 }],
      }],
      `busquedas-${seleccion.llave.replace(/\s+/g, '-')}.xlsx`,
    );
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Demanda de viajeros</h1>
          <p className="mt-2 text-gray-600">
            Todo lo que se busca, sin mínimo, y quién lo buscó cuando hubo sesión iniciada.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1">
            {PERIODOS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setDias(p)}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${dias === p ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}
              >
                {p} días
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setSoloSin((v) => !v)}
            className={`inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border ${soloSin ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'}`}
          >
            <SearchX className="w-4 h-4" />
            Solo sin resultados
          </button>
          <button
            type="button"
            onClick={descargarTerminos}
            disabled={filas.length === 0}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <Download className="w-4 h-4" />
            Excel
          </button>
        </div>
      </div>

      <p className="mb-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
        <ShieldAlert className="w-4 h-4 flex-shrink-0" />
        Esta pantalla muestra datos de personas. Solo hay nombre y correo cuando el viajero buscó con sesión iniciada y
        aceptó todas las cookies; el resto de las búsquedas son anónimas. Úsala para entender la demanda; para escribirle
        a alguien por una búsqueda, revisa antes el aviso de privacidad.
      </p>

      {terminos?.error && !cargandoTerminos && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{terminos.error}</div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        <section className="xl:col-span-3 rounded-xl border border-gray-200 bg-white overflow-hidden">
          {cargandoTerminos ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
            </div>
          ) : filas.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-gray-600">No hay búsquedas en este periodo.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Búsqueda</th>
                    <th className="px-3 py-2 font-medium text-right">Veces</th>
                    <th className="px-3 py-2 font-medium text-right">Sin result.</th>
                    <th className="px-3 py-2 font-medium text-right">Usuarios</th>
                    <th className="px-3 py-2 font-medium text-right">Tend.</th>
                    <th className="px-4 py-2 font-medium">Catálogo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {filas.map((t) => (
                    <tr
                      key={t.llave}
                      onClick={() => setSeleccion(t)}
                      className={`cursor-pointer hover:bg-gray-50 ${seleccion?.llave === t.llave ? 'bg-primary-50' : ''}`}
                    >
                      <td className="px-4 py-2.5 font-medium text-gray-900">{t.termino}</td>
                      <td className="px-3 py-2.5 text-right text-gray-700">{t.busquedas}</td>
                      <td className="px-3 py-2.5 text-right text-gray-700">{t.busquedas_sin_resultados}</td>
                      <td className="px-3 py-2.5 text-right text-gray-700">{t.usuarios_identificados}</td>
                      <td className="px-3 py-2.5 text-right"><Tendencia actual={t.busquedas} anterior={t.busquedas_periodo_anterior} /></td>
                      <td className="px-4 py-2.5">
                        {t.tours_coincidentes > 0
                          ? <span className="text-xs font-medium text-green-700">{t.tours_coincidentes} tour(s) · {t.agencias_coincidentes} agencia(s)</span>
                          : <span className="text-xs text-amber-700">Sin tours</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="xl:col-span-2 rounded-xl border border-gray-200 bg-white overflow-hidden">
          {!seleccion ? (
            <div className="flex flex-col items-center justify-center gap-2 px-6 py-20 text-center text-sm text-gray-500">
              <Search className="w-6 h-6 text-gray-300" />
              Elige un término para ver quién lo buscó.
            </div>
          ) : (
            <>
              <header className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
                <div>
                  <h2 className="font-semibold text-gray-900">{seleccion.termino}</h2>
                  <p className="text-xs text-gray-500">
                    {seleccion.tours_coincidentes > 0
                      ? `Ya hay ${seleccion.tours_coincidentes} tour(s) publicados de ${seleccion.agencias_coincidentes} agencia(s).`
                      : 'Todavía no hay tours publicados para este término.'}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button type="button" onClick={descargarDetalle} disabled={detalleFilas.length === 0}
                    className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 disabled:opacity-40" title="Descargar detalle">
                    <Download className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={() => setSeleccion(null)}
                    className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100" title="Cerrar">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </header>

              {cargandoDetalle ? (
                <div className="flex items-center justify-center py-16">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600"></div>
                </div>
              ) : detalle?.error ? (
                <p className="px-5 py-6 text-sm text-red-700">{detalle.error}</p>
              ) : (
                <>
                  <div className="border-b border-gray-100 px-5 py-3 text-xs text-gray-600">
                    {detalleFilas.length} búsqueda(s) · {personas.size} persona(s) identificada(s) · últimos {Math.max(dias, 90)} días
                  </div>
                  <ul className="max-h-[32rem] divide-y divide-gray-100 overflow-y-auto">
                    {detalleFilas.map((b, i) => (
                      <li key={`${b.creada_en}-${i}`} className="px-5 py-3 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-gray-900">
                            {b.nombre || (b.email ? 'Sin nombre' : 'Visitante anónimo')}
                          </span>
                          <span className="text-xs text-gray-400">{format(new Date(b.creada_en), 'dd/MM/yy HH:mm')}</span>
                        </div>
                        {b.email && (
                          <a href={`mailto:${b.email}`} className="text-xs text-primary-600 hover:underline">{b.email}</a>
                        )}
                        <div className="mt-0.5 text-xs text-gray-500">
                          Escribió «{b.texto_buscado}» · {b.resultados === 0 ? 'sin resultados' : `${b.resultados ?? '?'} resultado(s)`}
                          {b.dispositivo ? ` · ${b.dispositivo}` : ''}{b.origen ? ` · ${b.origen}` : ''}
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
};

export default AdminDemand;
