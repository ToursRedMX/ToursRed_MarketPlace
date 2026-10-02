import React, { useEffect, useState } from 'react';
import { BarChart2, Download, Search, SearchX, ShieldCheck, TrendingDown, TrendingUp } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { downloadExcel } from '../../utils/excelExport';

/**
 * Demanda de viajeros: que buscan en ToursRed y que buscan sin encontrar.
 *
 * Los datos salen de `agency_demand_summary` y `agency_demand_top`
 * (migracion 20261002180000), que devuelven solo agregados: un termino aparece
 * si se busco al menos 3 veces, y nunca hay datos de personas. Las agencias no
 * leen `search_events` directamente.
 */

interface ResumenDemanda {
  periodo_dias: number;
  total_busquedas: number;
  con_resultados: number;
  sin_resultados: number;
  busquedas_periodo_anterior: number;
}

interface TerminoDemanda {
  termino: string;
  busquedas: number;
  busquedas_sin_resultados: number;
  sesiones: number;
  busquedas_periodo_anterior: number;
  cubierto_por_mi: boolean;
}

const PERIODOS = [
  { dias: 7, etiqueta: '7 días' },
  { dias: 30, etiqueta: '30 días' },
  { dias: 90, etiqueta: '90 días' },
];

function Tendencia({ actual, anterior }: { actual: number; anterior: number }) {
  if (anterior === 0) {
    return <span className="text-xs text-gray-400">nuevo</span>;
  }
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

const AgencyDemand: React.FC = () => {
  const [dias, setDias] = useState(30);
  // El resultado lleva el periodo con que se pidio: si no coincide con `dias`
  // aun se esta cargando, sin tener que apagar y prender un estado en el efecto.
  const [datos, setDatos] = useState<{
    dias: number;
    error: string | null;
    resumen: ResumenDemanda | null;
    masBuscados: TerminoDemanda[];
    sinResultados: TerminoDemanda[];
  } | null>(null);

  useEffect(() => {
    let cancelado = false;
    (async () => {
      const [res, top, sin] = await Promise.all([
        supabase.rpc('agency_demand_summary', { p_days: dias }),
        supabase.rpc('agency_demand_top', { p_days: dias, p_limit: 20, p_solo_sin_resultados: false }),
        supabase.rpc('agency_demand_top', { p_days: dias, p_limit: 20, p_solo_sin_resultados: true }),
      ]);
      if (cancelado) return;
      const fallo = res.error || top.error || sin.error;
      if (fallo) {
        console.error('AgencyDemand: no se pudo cargar el reporte', fallo);
        setDatos({
          dias,
          error: 'No pudimos cargar el reporte de demanda. Intenta de nuevo en unos minutos.',
          resumen: null,
          masBuscados: [],
          sinResultados: [],
        });
        return;
      }
      setDatos({
        dias,
        error: null,
        resumen: (res.data as ResumenDemanda[] | null)?.[0] ?? null,
        masBuscados: (top.data as TerminoDemanda[] | null) ?? [],
        sinResultados: (sin.data as TerminoDemanda[] | null) ?? [],
      });
    })();
    return () => {
      cancelado = true;
    };
  }, [dias]);

  const isLoading = datos?.dias !== dias;
  const error = isLoading ? null : datos?.error ?? null;
  const resumen = datos?.resumen ?? null;
  const masBuscados = datos?.masBuscados ?? [];
  const sinResultados = datos?.sinResultados ?? [];

  const descargar = async () => {
    await downloadExcel(
      [
        {
          sheet: 'Más buscados',
          data: [
            ['Búsqueda', 'Veces buscado', 'Sin resultados', 'Sesiones distintas', 'Periodo anterior', 'Tengo un tour para esto'],
            ...masBuscados.map((t) => [
              t.termino, t.busquedas, t.busquedas_sin_resultados, t.sesiones,
              t.busquedas_periodo_anterior, t.cubierto_por_mi ? 'Sí' : 'No',
            ]),
          ],
          columns: [{ width: 28 }, { width: 14 }, { width: 14 }, { width: 18 }, { width: 16 }, { width: 24 }],
        },
        {
          sheet: 'Sin resultados',
          data: [
            ['Búsqueda', 'Veces sin resultados', 'Veces buscado', 'Periodo anterior', 'Tengo un tour para esto'],
            ...sinResultados.map((t) => [
              t.termino, t.busquedas_sin_resultados, t.busquedas,
              t.busquedas_periodo_anterior, t.cubierto_por_mi ? 'Sí' : 'No',
            ]),
          ],
          columns: [{ width: 28 }, { width: 20 }, { width: 14 }, { width: 16 }, { width: 24 }],
        },
      ],
      `demanda-de-viajeros-${dias}-dias.xlsx`,
    );
  };

  const hayDatos = masBuscados.length > 0 || sinResultados.length > 0;
  const porcentajeSin = resumen && resumen.total_busquedas > 0
    ? Math.round((resumen.sin_resultados / resumen.total_busquedas) * 100)
    : 0;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Demanda de viajeros</h1>
          <p className="mt-2 text-gray-600">
            Qué buscan los viajeros en ToursRed y qué buscan sin encontrar. Es demanda real que puedes atender.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1">
            {PERIODOS.map((p) => (
              <button
                key={p.dias}
                type="button"
                onClick={() => setDias(p.dias)}
                className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                  dias === p.dias ? 'bg-primary-600 text-white' : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                {p.etiqueta}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={descargar}
            disabled={!hayDatos}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="w-4 h-4" />
            Excel
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-24">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary-600"></div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <div className="flex items-center gap-2 text-sm text-gray-500"><Search className="w-4 h-4" />Búsquedas en la plataforma</div>
              <p className="mt-2 text-3xl font-bold text-gray-900">{resumen?.total_busquedas ?? 0}</p>
              {resumen && <div className="mt-1"><Tendencia actual={resumen.total_busquedas} anterior={resumen.busquedas_periodo_anterior} /></div>}
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-5">
              <div className="flex items-center gap-2 text-sm text-gray-500"><BarChart2 className="w-4 h-4" />Con resultados</div>
              <p className="mt-2 text-3xl font-bold text-gray-900">{resumen?.con_resultados ?? 0}</p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
              <div className="flex items-center gap-2 text-sm text-amber-800"><SearchX className="w-4 h-4" />Sin resultados</div>
              <p className="mt-2 text-3xl font-bold text-amber-900">{resumen?.sin_resultados ?? 0}</p>
              <p className="mt-1 text-xs text-amber-800">{porcentajeSin}% de las búsquedas</p>
            </div>
          </div>

          {!hayDatos && (
            <div className="rounded-xl border border-dashed border-gray-300 bg-white p-8 text-center">
              <p className="font-medium text-gray-900">Aún no hay suficientes búsquedas para mostrar términos</p>
              <p className="mt-2 text-sm text-gray-600">
                Para cuidar la privacidad de los viajeros, un término aparece solo cuando se ha buscado al menos 3 veces
                en el periodo. Conforme crezca la plataforma, aquí verás los destinos más buscados.
              </p>
            </div>
          )}

          {hayDatos && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <section className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                <header className="px-5 py-4 border-b border-gray-100">
                  <h2 className="font-semibold text-gray-900">Lo más buscado</h2>
                  <p className="text-xs text-gray-500">Veces que se buscó en los últimos {dias} días</p>
                </header>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-5 py-2 font-medium">Búsqueda</th>
                      <th className="px-3 py-2 font-medium text-right">Veces</th>
                      <th className="px-3 py-2 font-medium text-right">Tendencia</th>
                      <th className="px-5 py-2 font-medium">Tu catálogo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {masBuscados.map((t) => (
                      <tr key={t.termino}>
                        <td className="px-5 py-2.5 font-medium text-gray-900">{t.termino}</td>
                        <td className="px-3 py-2.5 text-right text-gray-700">{t.busquedas}</td>
                        <td className="px-3 py-2.5 text-right"><Tendencia actual={t.busquedas} anterior={t.busquedas_periodo_anterior} /></td>
                        <td className="px-5 py-2.5">
                          {t.cubierto_por_mi
                            ? <span className="text-xs font-medium text-green-700">Tienes un tour</span>
                            : <span className="text-xs text-gray-400">Sin tour</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <section className="rounded-xl border border-amber-200 bg-white overflow-hidden">
                <header className="px-5 py-4 border-b border-amber-100 bg-amber-50">
                  <h2 className="font-semibold text-amber-900">Buscado y sin resultados</h2>
                  <p className="text-xs text-amber-800">Demanda que hoy nadie atiende: una oportunidad para publicar un tour</p>
                </header>
                {sinResultados.length === 0 ? (
                  <p className="px-5 py-6 text-sm text-gray-600">Ningún término llegó al mínimo de 3 búsquedas sin resultados.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                      <tr>
                        <th className="px-5 py-2 font-medium">Búsqueda</th>
                        <th className="px-3 py-2 font-medium text-right">Sin resultados</th>
                        <th className="px-5 py-2 font-medium text-right">Tendencia</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {sinResultados.map((t) => (
                        <tr key={t.termino}>
                          <td className="px-5 py-2.5 font-medium text-gray-900">{t.termino}</td>
                          <td className="px-3 py-2.5 text-right text-gray-700">{t.busquedas_sin_resultados}</td>
                          <td className="px-5 py-2.5 text-right"><Tendencia actual={t.busquedas} anterior={t.busquedas_periodo_anterior} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            </div>
          )}

          <p className="mt-8 flex items-start gap-2 text-xs text-gray-500">
            <ShieldCheck className="w-4 h-4 flex-shrink-0 text-gray-400" />
            Los datos son agregados de toda la plataforma. Nunca incluyen quién buscó: no se muestran viajeros, correos ni
            teléfonos, y los términos con menos de 3 búsquedas no aparecen.
          </p>
        </>
      )}
    </div>
  );
};

export default AgencyDemand;
