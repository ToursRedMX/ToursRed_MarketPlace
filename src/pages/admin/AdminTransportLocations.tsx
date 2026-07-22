import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { MapPin, RefreshCw, AlertCircle, CheckCircle, Clock, Play, Database } from 'lucide-react';

interface City {
  id: string;
  name: string;
  state: string;
  is_active: boolean;
  priority: number;
}

interface TransportSystem {
  id: string;
  city_id: string;
  name: string;
  system_type: string;
  operator: string;
  color: string;
  icon: string;
  is_active: boolean;
}

interface SyncLog {
  id: string;
  city_id: string;
  status: string;
  started_at: string;
  completed_at: string;
  total_processed: number;
  total_inserted: number;
  total_updated: number;
  total_errors: number;
  execution_mode: string;
  cities: { name: string };
}

export default function AdminTransportLocations() {
  const [cities, setCities] = useState<City[]>([]);
  const [systems, setSystems] = useState<TransportSystem[]>([]);
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [selectedCities, setSelectedCities] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [citiesRes, systemsRes, logsRes, statsRes] = await Promise.all([
        supabase.from('cities').select('*').order('priority'),
        supabase.from('transport_systems').select('*').order('name'),
        supabase.from('osm_sync_logs').select('*, cities(name)').order('started_at', { ascending: false }).limit(10),
        supabase.from('departure_locations').select('city, place_type', { count: 'exact', head: false }),
      ]);

      if (citiesRes.error) throw citiesRes.error;
      if (systemsRes.error) throw systemsRes.error;
      if (logsRes.error) throw logsRes.error;

      setCities(citiesRes.data || []);
      setSystems(systemsRes.data || []);
      setSyncLogs(logsRes.data || []);

      if (statsRes.data) {
        const statsByCity: any = {};
        const statsByType: any = {};
        statsRes.data.forEach((item: any) => {
          statsByCity[item.city] = (statsByCity[item.city] || 0) + 1;
          statsByType[item.place_type] = (statsByType[item.place_type] || 0) + 1;
        });
        setStats({ byCity: statsByCity, byType: statsByType, total: statsRes.data.length });
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async () => {
    if (selectedCities.length === 0) {
      setError('Por favor selecciona al menos una ciudad');
      return;
    }

    try {
      setSyncing(true);
      setError(null);
      setSuccess(null);

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('No hay sesión activa');

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-transport-locations`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            cityIds: selectedCities,
            forceRefresh: true,
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Error al sincronizar');
      }

      setSuccess(
        `Sincronización completada: ${result.stats.totalInserted} insertados, ${result.stats.totalUpdated} actualizados`
      );
      await loadData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  };

  const toggleCitySelection = (cityId: string) => {
    setSelectedCities((prev) =>
      prev.includes(cityId) ? prev.filter((id) => id !== cityId) : [...prev, cityId]
    );
  };

  const selectAllCities = () => {
    setSelectedCities(cities.filter((c) => c.is_active).map((c) => c.id));
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'completed_with_errors':
        return <AlertCircle className="w-5 h-5 text-yellow-500" />;
      case 'running':
        return <Clock className="w-5 h-5 text-blue-500 animate-pulse" />;
      default:
        return <AlertCircle className="w-5 h-5 text-red-500" />;
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'completed':
        return 'Completado';
      case 'completed_with_errors':
        return 'Completado con errores';
      case 'running':
        return 'En ejecución';
      default:
        return 'Error';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Ubicaciones de Transporte Público</h1>
        <p className="text-gray-600">
          Gestiona y sincroniza ubicaciones de transporte público desde OpenStreetMap
        </p>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-red-900">Error</p>
            <p className="text-red-700 text-sm">{error}</p>
          </div>
        </div>
      )}

      {success && (
        <div className="mb-6 bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-3">
          <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-green-900">Éxito</p>
            <p className="text-green-700 text-sm">{success}</p>
          </div>
        </div>
      )}

      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center gap-3 mb-2">
              <Database className="w-6 h-6 text-blue-600" />
              <h3 className="font-semibold text-gray-900">Total de Ubicaciones</h3>
            </div>
            <p className="text-3xl font-bold text-blue-600">{stats.total.toLocaleString()}</p>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center gap-3 mb-2">
              <MapPin className="w-6 h-6 text-green-600" />
              <h3 className="font-semibold text-gray-900">Ciudades Activas</h3>
            </div>
            <p className="text-3xl font-bold text-green-600">{cities.filter((c) => c.is_active).length}</p>
          </div>

          <div className="bg-white rounded-lg shadow p-6">
            <div className="flex items-center gap-3 mb-2">
              <RefreshCw className="w-6 h-6 text-purple-600" />
              <h3 className="font-semibold text-gray-900">Tipos de Transporte</h3>
            </div>
            <p className="text-3xl font-bold text-purple-600">{Object.keys(stats.byType).length}</p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow mb-8">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold mb-4">Sincronizar desde OpenStreetMap</h2>
          <p className="text-gray-600 mb-4">
            Selecciona las ciudades que deseas sincronizar. El proceso extraerá estaciones de metro, paradas de
            autobús y otros puntos de transporte desde OpenStreetMap.
          </p>

          <div className="flex gap-3 mb-6">
            <button
              onClick={selectAllCities}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              disabled={syncing}
            >
              Seleccionar Todas
            </button>
            <button
              onClick={() => setSelectedCities([])}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
              disabled={syncing}
            >
              Deseleccionar Todas
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {cities.map((city) => (
              <label
                key={city.id}
                className={`flex items-center gap-3 p-4 rounded-lg border-2 cursor-pointer transition-all ${
                  selectedCities.includes(city.id)
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                } ${!city.is_active ? 'opacity-50' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={selectedCities.includes(city.id)}
                  onChange={() => toggleCitySelection(city.id)}
                  disabled={!city.is_active || syncing}
                  className="w-4 h-4 text-blue-600 rounded focus:ring-2 focus:ring-blue-500"
                />
                <div>
                  <p className="font-medium text-gray-900">{city.name}</p>
                  <p className="text-sm text-gray-500">{city.state}</p>
                  {stats?.byCity[city.name] && (
                    <p className="text-xs text-blue-600 mt-1">{stats.byCity[city.name]} ubicaciones</p>
                  )}
                </div>
              </label>
            ))}
          </div>

          <button
            onClick={handleSync}
            disabled={syncing || selectedCities.length === 0}
            className="w-full md:w-auto px-6 py-3 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {syncing ? (
              <>
                <RefreshCw className="w-5 h-5 animate-spin" />
                Sincronizando...
              </>
            ) : (
              <>
                <Play className="w-5 h-5" />
                Iniciar Sincronización
              </>
            )}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow mb-8">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold">Sistemas de Transporte Configurados</h2>
        </div>
        <div className="p-6">
          <div className="space-y-4">
            {cities.map((city) => {
              const citySystems = systems.filter((s) => s.city_id === city.id && s.is_active);
              if (citySystems.length === 0) return null;

              return (
                <div key={city.id} className="border border-gray-200 rounded-lg p-4">
                  <h3 className="font-semibold text-gray-900 mb-3">
                    {city.name}, {city.state}
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {citySystems.map((system) => (
                      <div
                        key={system.id}
                        className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg"
                        style={{ borderLeft: `4px solid ${system.color}` }}
                      >
                        <div className="flex-1">
                          <p className="font-medium text-gray-900 text-sm">{system.name}</p>
                          <p className="text-xs text-gray-500">{system.system_type}</p>
                          {system.operator && <p className="text-xs text-gray-400">{system.operator}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-xl font-bold">Historial de Sincronizaciones</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Estado
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Ciudad
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Fecha
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Procesados
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Insertados
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Actualizados
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Errores
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {syncLogs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-4 text-center text-gray-500">
                    No hay sincronizaciones registradas
                  </td>
                </tr>
              ) : (
                syncLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {getStatusIcon(log.status)}
                        <span className="text-sm text-gray-900">{getStatusText(log.status)}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {log.cities?.name || 'Todas'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(log.started_at).toLocaleString('es-MX')}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {log.total_processed}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600">
                      {log.total_inserted}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-blue-600">
                      {log.total_updated}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-red-600">
                      {log.total_errors}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
