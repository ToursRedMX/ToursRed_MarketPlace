import React, { useState, useEffect } from 'react';
import { Users, Building, MapPin, Calendar, TrendingUp, Activity, BarChart2, ArrowRight, FileSpreadsheet, Shield, AlertTriangle, LogIn } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';

interface DashboardStats {
  totalUsers: number;
  totalTravelers: number;
  totalAgencies: number;
  activeAgencies: number;
  totalTours: number;
  totalBookings: number;
  totalDestinations: number;
  recentActivity: any[];
}

interface SecurityStats {
  failedLoginsToday: number;
  activeSessions: number;
  blockedIps: number;
}

const AdminDashboard: React.FC = () => {
  const { isSuperAdmin, permissions } = useAuth();
  const canViewAudit = isSuperAdmin || permissions?.canViewAuditLog;

  const [secStats, setSecStats] = useState<SecurityStats>({ failedLoginsToday: 0, activeSessions: 0, blockedIps: 0 });

  const [stats, setStats] = useState<DashboardStats>({
    totalUsers: 0,
    totalTravelers: 0,
    totalAgencies: 0,
    activeAgencies: 0,
    totalTours: 0,
    totalBookings: 0,
    totalDestinations: 0,
    recentActivity: []
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchDashboardStats();
    if (canViewAudit) fetchSecurityStats();
  }, [canViewAudit]);

  const fetchSecurityStats = async () => {
    try {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const [failedRes, activeRes, blockedRes] = await Promise.all([
        supabase.rpc('get_audit_logs', {
          p_action: 'FAILED_LOGIN',
          p_date_from: todayStart.toISOString(),
          p_limit: 1000,
          p_offset: 0,
        }),
        supabase.rpc('get_audit_logs', {
          p_action: 'LOGIN',
          p_date_from: todayStart.toISOString(),
          p_limit: 1000,
          p_offset: 0,
        }),
        supabase.rpc('get_blocked_ips_count'),
      ]);

      const failedCount = failedRes.data?.[0]?.total_count ?? failedRes.data?.length ?? 0;
      const loginCount = activeRes.data?.[0]?.total_count ?? activeRes.data?.length ?? 0;

      setSecStats({
        failedLoginsToday: Number(failedCount),
        activeSessions: Number(loginCount),
        blockedIps: Number(blockedRes.data ?? 0),
      });
    } catch {
      // best-effort
    }
  };

  const fetchDashboardStats = async () => {
    try {
      setIsLoading(true);
      setError('');

      console.log('📊 Cargando estadísticas del dashboard...');

      // Obtener estadísticas en paralelo
      // OPTIMIZED: Only count IDs instead of selecting all columns
      const [
        usersResult,
        travelersResult,
        agenciesResult,
        toursResult,
        bookingsResult,
        destinationsResult
      ] = await Promise.all([
        supabase.from('users').select('id', { count: 'exact', head: true }),
        supabase.from('users').select('id', { count: 'exact', head: true }).eq('role', 'traveler'),
        supabase.from('agencies').select('id', { count: 'exact', head: true }),
        supabase.from('tours').select('id', { count: 'exact', head: true }),
        supabase.from('bookings').select('id', { count: 'exact', head: true }).neq('status', 'draft'),
        supabase.from('destinations').select('id', { count: 'exact', head: true })
      ]);

      // Obtener agencias activas (OPTIMIZED: only count IDs)
      const { count: activeAgenciesCount } = await supabase
        .from('agencies')
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true);

      // Obtener actividad reciente (últimas 10 acciones)
      const { data: recentBookings } = await supabase
        .from('bookings')
        .select(`
          id,
          created_at,
          status,
          users!bookings_user_id_fkey(first_name, last_name, email),
          tours(name),
          agencies(name)
        `)
        .neq('status', 'draft')
        .order('created_at', { ascending: false })
        .limit(5);

      setStats({
        totalUsers: usersResult.count || 0,
        totalTravelers: travelersResult.count || 0,
        totalAgencies: agenciesResult.count || 0,
        activeAgencies: activeAgenciesCount || 0,
        totalTours: toursResult.count || 0,
        totalBookings: bookingsResult.count || 0,
        totalDestinations: destinationsResult.count || 0,
        recentActivity: recentBookings || []
      });

      console.log('✅ Estadísticas cargadas:', {
        users: usersResult.count,
        travelers: travelersResult.count,
        agencies: agenciesResult.count,
        tours: toursResult.count,
        bookings: bookingsResult.count,
        destinations: destinationsResult.count
      });

    } catch (err: any) {
      console.error('❌ Error cargando estadísticas:', err);
      setError(err.message || 'Error al cargar las estadísticas');
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'confirmed': return 'text-success-600 bg-success-100';
      case 'pending': return 'text-warning-600 bg-warning-100';
      case 'cancelled': return 'text-error-600 bg-error-100';
      case 'cancellation_processing': return 'text-amber-600 bg-amber-100';
      case 'completed': return 'text-primary-600 bg-primary-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'confirmed': return 'Confirmada';
      case 'pending': return 'Pendiente';
      case 'cancelled': return 'Cancelada';
      case 'cancellation_processing': return 'Cancelación en Proceso';
      case 'completed': return 'Completada';
      default: return status;
    }
  };

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-600"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Panel de Administración</h1>
        <p className="text-gray-600 mt-1">
          Resumen general de la plataforma TourRed
        </p>
      </div>

      {error && (
        <div className="mb-6 bg-error-50 text-error-600 p-4 rounded-md">
          {error}
        </div>
      )}

      {/* Estadísticas principales */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7 gap-6 mb-8">
        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <Users className="h-8 w-8 text-primary-600" />
            </div>
            <div className="ml-4">
              <div className="text-2xl font-bold text-gray-900">{stats.totalUsers}</div>
              <div className="text-sm text-gray-500">Total Usuarios</div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <Users className="h-8 w-8 text-blue-500" />
            </div>
            <div className="ml-4">
              <div className="text-2xl font-bold text-gray-900">{stats.totalTravelers}</div>
              <div className="text-sm text-gray-500">Total Viajeros</div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <Building className="h-8 w-8 text-success-600" />
            </div>
            <div className="ml-4">
              <div className="text-2xl font-bold text-gray-900">{stats.totalAgencies}</div>
              <div className="text-sm text-gray-500">Total Agencias</div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <Activity className="h-8 w-8 text-accent-600" />
            </div>
            <div className="ml-4">
              <div className="text-2xl font-bold text-gray-900">{stats.activeAgencies}</div>
              <div className="text-sm text-gray-500">Agencias Activas</div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <MapPin className="h-8 w-8 text-secondary-600" />
            </div>
            <div className="ml-4">
              <div className="text-2xl font-bold text-gray-900">{stats.totalTours}</div>
              <div className="text-sm text-gray-500">Tours Publicados</div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <Calendar className="h-8 w-8 text-warning-600" />
            </div>
            <div className="ml-4">
              <div className="text-2xl font-bold text-gray-900">{stats.totalBookings}</div>
              <div className="text-sm text-gray-500">Total Reservas</div>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <TrendingUp className="h-8 w-8 text-error-600" />
            </div>
            <div className="ml-4">
              <div className="text-2xl font-bold text-gray-900">{stats.totalDestinations}</div>
              <div className="text-sm text-gray-500">Destinos</div>
            </div>
          </div>
        </div>
      </div>

      {/* Actividad reciente */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Actividad Reciente</h2>
          {stats.recentActivity.length > 0 ? (
            <div className="space-y-4">
              {stats.recentActivity.map((activity) => (
                <div key={activity.id} className="flex items-start space-x-3">
                  <div className="flex-shrink-0">
                    <Calendar className="h-5 w-5 text-gray-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-gray-900">
                      <span className="font-medium">
                        {activity.users?.first_name} {activity.users?.last_name}
                      </span>
                      {' '}reservó{' '}
                      <span className="font-medium">{activity.tours?.name}</span>
                      {' '}con{' '}
                      <span className="font-medium">{activity.agencies?.name}</span>
                    </div>
                    <div className="flex items-center mt-1 space-x-2">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getStatusColor(activity.status)}`}>
                        {getStatusText(activity.status)}
                      </span>
                      <span className="text-xs text-gray-500">
                        {new Date(activity.created_at).toLocaleDateString('es-ES')}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <Activity className="h-8 w-8 text-gray-400 mx-auto mb-2" />
              <p className="text-gray-500">No hay actividad reciente</p>
            </div>
          )}
        </div>

        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Resumen del Sistema</h2>
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Tasa de agencias activas</span>
              <span className="text-sm font-medium">
                {stats.totalAgencies > 0 
                  ? Math.round((stats.activeAgencies / stats.totalAgencies) * 100)
                  : 0
                }%
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Tours por agencia (promedio)</span>
              <span className="text-sm font-medium">
                {stats.activeAgencies > 0 
                  ? Math.round(stats.totalTours / stats.activeAgencies * 10) / 10
                  : 0
                }
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Reservas por tour (promedio)</span>
              <span className="text-sm font-medium">
                {stats.totalTours > 0 
                  ? Math.round(stats.totalBookings / stats.totalTours * 10) / 10
                  : 0
                }
              </span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Estado de la plataforma</span>
              <span className={`text-sm font-medium ${
                stats.totalAgencies > 0 && stats.totalTours > 0 
                  ? 'text-success-600' 
                  : 'text-warning-600'
              }`}>
                {stats.totalAgencies > 0 && stats.totalTours > 0 
                  ? 'Operativa' 
                  : 'En desarrollo'
                }
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Seguridad */}
      {canViewAudit && (
        <div className="mt-6 bg-white rounded-lg shadow-md p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-slate-700" />
              <h2 className="text-lg font-semibold text-gray-900">Seguridad</h2>
            </div>
            <Link to="/admin/audit-log" className="text-sm text-blue-600 hover:underline flex items-center gap-1">
              Ver registro completo <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-amber-50 border border-amber-100 rounded-lg p-4 flex items-center gap-3">
              <AlertTriangle className="w-7 h-7 text-amber-500 flex-shrink-0" />
              <div>
                <div className="text-2xl font-bold text-gray-900">{secStats.failedLoginsToday}</div>
                <div className="text-xs text-gray-500">Intentos fallidos hoy</div>
              </div>
            </div>
            <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-4 flex items-center gap-3">
              <LogIn className="w-7 h-7 text-emerald-500 flex-shrink-0" />
              <div>
                <div className="text-2xl font-bold text-gray-900">{secStats.activeSessions}</div>
                <div className="text-xs text-gray-500">Logins exitosos hoy</div>
              </div>
            </div>
            <div className="bg-slate-50 border border-slate-100 rounded-lg p-4 flex items-center gap-3">
              <Shield className="w-7 h-7 text-slate-400 flex-shrink-0" />
              <div>
                <div className="text-2xl font-bold text-gray-900">{secStats.blockedIps}</div>
                <div className="text-xs text-gray-500">IPs bloqueadas</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Acceso rápido a métricas por tour */}
      <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link
          to="/admin/tour-metrics"
          className="flex items-center justify-between w-full bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl p-5 hover:from-blue-700 hover:to-blue-800 transition-all shadow-sm group"
        >
          <div className="flex items-center gap-4">
            <div className="p-2.5 bg-white/20 rounded-lg">
              <BarChart2 size={22} />
            </div>
            <div>
              <p className="font-semibold text-base">Metricas por Tour</p>
              <p className="text-blue-100 text-sm mt-0.5">Reservas, viajeros, ingresos y ocupacion por cada tour</p>
            </div>
          </div>
          <ArrowRight size={20} className="opacity-70 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
        </Link>

        <Link
          to="/admin/reporte-maestro"
          className="flex items-center justify-between w-full bg-gradient-to-r from-emerald-600 to-teal-700 text-white rounded-xl p-5 hover:from-emerald-700 hover:to-teal-800 transition-all shadow-sm group"
        >
          <div className="flex items-center gap-4">
            <div className="p-2.5 bg-white/20 rounded-lg">
              <FileSpreadsheet size={22} />
            </div>
            <div>
              <p className="font-semibold text-base">Reporte Maestro</p>
              <p className="text-emerald-100 text-sm mt-0.5">Log completo de todos los ingresos y egresos de la plataforma</p>
            </div>
          </div>
          <ArrowRight size={20} className="opacity-70 group-hover:opacity-100 group-hover:translate-x-1 transition-all" />
        </Link>
      </div>
    </div>
  );
};

export default AdminDashboard;