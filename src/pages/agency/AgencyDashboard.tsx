import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, MapPin, Calendar, Users, DollarSign, Activity, AlertCircle, CreditCard, Crown, Clock, Tag, Sparkles, Eye, MousePointerClick, Share2, ArrowRight, BarChart2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useAgencyId } from '../../hooks/useAgencyId';
import { formatCurrency, formatCurrencyMXN } from '../../utils/formatCurrency';
import { supabase } from '../../lib/supabase';

interface DashboardStats {
  totalTours: number;
  activeTours: number;
  totalBookings: number;
  recentBookings: number;
  totalTravelers: number;
  totalRevenue: number;
  pendingPayouts: number;
  recentActivity: any[];
}

interface PreventaStats {
  tourId: string;
  tourName: string;
  reservasCount: number;
  ahorroAcumulado: number;
  diasRestantes: number;
  beneficioAgotado: boolean;
}

const AgencyDashboard: React.FC = () => {
  const { user, isAgencyStaff, staffInfo } = useAuth();
  const { agencyId: hookAgencyId } = useAgencyId();
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats>({
    totalTours: 0,
    activeTours: 0,
    totalBookings: 0,
    recentBookings: 0,
    totalTravelers: 0,
    totalRevenue: 0,
    pendingPayouts: 0,
    recentActivity: []
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [agencyId, setAgencyId] = useState<string | null>(null);
  const [preventaStats, setPreventaStats] = useState<PreventaStats[]>([]);

  useEffect(() => {
    if (hookAgencyId) {
      fetchAgencyData(hookAgencyId);
    }
  }, [hookAgencyId]);

  const fetchAgencyData = async (resolvedAgencyId: string) => {
    try {
      setIsLoading(true);
      setError('');

      setAgencyId(resolvedAgencyId);
      const agencyData = { id: resolvedAgencyId };

      // OPTIMIZED: Select only needed columns + pagination
      const [
        toursResult,
        bookingsResult,
        recentBookingsResult,
        commissionRecordsResult
      ] = await Promise.all([
        // Tours de la agencia (OPTIMIZED: limit 100)
        supabase
          .from('tours')
          .select('id, name, destination, price, is_featured, start_date, end_date, preventa_activa, preventa_inicio, preventa_fin')
          .eq('agency_id', agencyData.id)
          .limit(100),

        // Reservas de la agencia (OPTIMIZED: only needed columns + limit 100)
        supabase
          .from('bookings')
          .select(`
            id,
            status,
            created_at,
            total_price,
            tour_id,
            tours(name, destination),
            users!bookings_user_id_fkey(first_name, last_name, email)
          `)
          .eq('agency_id', agencyData.id)
          .limit(100),

        // Reservas recientes (últimos 30 días) - OPTIMIZED: only needed columns
        supabase
          .from('bookings')
          .select('id, status, created_at, total_price')
          .eq('agency_id', agencyData.id)
          .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
          .limit(50),

        // Registros de comisiones (OPTIMIZED: only needed columns + limit)
        supabase
          .from('commission_records')
          .select('agency_net_amount, agency_commission_amount, status, created_at')
          .eq('agency_id', agencyData.id)
          .limit(100)
      ]);

      if (toursResult.error) {
        console.error('Error cargando tours:', toursResult.error);
      }

      if (bookingsResult.error) {
        console.error('Error cargando reservas:', bookingsResult.error);
      }

      if (recentBookingsResult.error) {
        console.error('Error cargando reservas recientes:', recentBookingsResult.error);
      }

      if (commissionRecordsResult.error) {
        console.error('Error cargando registros de comisiones:', commissionRecordsResult.error);
      }

      const tours = toursResult.data || [];
      const bookings = bookingsResult.data || [];
      const recentBookings = recentBookingsResult.data || [];
      const commissionRecords = commissionRecordsResult.data || [];

      // Calcular tours activos (que no han terminado)
      const today = new Date();
      const activeTours = tours.filter(tour => new Date(tour.end_date) >= today);

      // Calcular total de viajeros
      const totalTravelers = bookings
        .filter(booking => booking.status !== 'cancelled')
        .reduce((sum, booking) => sum + (booking.travelers_count || 0), 0);

      // Calcular ingresos reales basados en commission_records
      // Esto representa lo que la agencia realmente recibe después de comisiones
      const totalRevenue = commissionRecords
        .filter(record => record.status === 'processed')
        .reduce((sum, record) => sum + (record.agency_net_amount || 0), 0);

      // Calcular pagos pendientes (comisiones procesadas pero no pagadas)
      const pendingPayouts = commissionRecords
        .filter(record => record.status === 'processed')
        .reduce((sum, record) => sum + (record.agency_net_amount || 0), 0);

      // Actividad reciente (últimas 5 reservas)
      const recentActivity = bookings
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 5);

      const dashboardStats: DashboardStats = {
        totalTours: tours.length,
        activeTours: activeTours.length,
        totalBookings: bookings.length,
        recentBookings: recentBookings.length,
        totalTravelers,
        totalRevenue,
        pendingPayouts,
        recentActivity
      };

      setStats(dashboardStats);

      // Calcular preventas activas hoy
      const todayStr = new Date().toISOString().split('T')[0];
      const toursEnPreventa = tours.filter((t: any) =>
        t.preventa_activa &&
        t.preventa_inicio && t.preventa_inicio <= todayStr &&
        t.preventa_fin && t.preventa_fin >= todayStr
      );

      if (toursEnPreventa.length > 0) {
        const tourIdsEnPreventa = toursEnPreventa.map((t: any) => t.id);
        const { data: preventaBookings } = await supabase
          .from('bookings')
          .select('tour_id, preventa_comision_descuento')
          .in('tour_id', tourIdsEnPreventa)
          .eq('es_reserva_preventa', true)
          .not('status', 'eq', 'cancelled');

        const statsMap: Record<string, { count: number; ahorro: number }> = {};
        for (const b of preventaBookings || []) {
          if (!statsMap[b.tour_id]) statsMap[b.tour_id] = { count: 0, ahorro: 0 };
          statsMap[b.tour_id].count += 1;
          statsMap[b.tour_id].ahorro += parseFloat(b.preventa_comision_descuento || 0);
        }

        const pStats: PreventaStats[] = toursEnPreventa.map((t: any) => {
          const fin = new Date(t.preventa_fin + 'T23:59:59');
          const diasRestantes = Math.max(0, Math.ceil((fin.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
          const data = statsMap[t.id] || { count: 0, ahorro: 0 };
          return {
            tourId: t.id,
            tourName: t.name,
            reservasCount: data.count,
            ahorroAcumulado: Math.round(data.ahorro * 100) / 100,
            diasRestantes,
            beneficioAgotado: data.count >= 10,
          };
        });

        setPreventaStats(pStats);
      } else {
        setPreventaStats([]);
      }
      
    } catch (err: any) {
      console.error('❌ Error cargando datos de agencia:', err);
      setError(err.message || 'Error al cargar los datos de la agencia');
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'confirmed': return 'text-success-600 bg-success-100';
      case 'pending': return 'text-warning-600 bg-warning-100';
      case 'cancelled': return 'text-error-600 bg-error-100';
      case 'completed': return 'text-primary-600 bg-primary-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'confirmed': return 'Confirmada';
      case 'pending': return 'Pendiente';
      case 'cancelled': return 'Cancelada';
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

  if (error && !agencyId) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="bg-white rounded-lg shadow-md p-8 text-center">
          <h3 className="text-xl font-semibold mb-2">Error al cargar datos</h3>
          <p className="text-gray-600 mb-6">{error}</p>
          <button 
            onClick={fetchAgencyData}
            className="btn btn-primary"
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold">Panel de la Agencia</h1>
          {isAgencyStaff && staffInfo && (
            <p className="text-sm text-gray-500 mt-1">
              Coordinador de <span className="font-medium text-primary-600">{staffInfo.agencyName}</span> &mdash; {staffInfo.title}
            </p>
          )}
        </div>
        {(!isAgencyStaff || staffInfo?.permissions.canManageTours) && (
          <button
            onClick={() => navigate('/agency/tours')}
            className="btn btn-primary"
          >
            <Plus className="h-5 w-5 mr-2" />
            Crear Nuevo Tour
          </button>
        )}
      </div>

      {error && (
        <div className="mb-6 bg-error-50 text-error-600 p-4 rounded-md">
          {error}
        </div>
      )}

      {/* Información sobre el sistema de pagos */}
      {stats.totalRevenue === 0 && stats.totalBookings > 0 && (
        <div className="mb-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start">
            <AlertCircle className="h-5 w-5 text-blue-500 mt-0.5 mr-3 flex-shrink-0" />
            <div>
              <h3 className="font-medium text-blue-900 mb-2">Sistema de Pagos y Comisiones</h3>
              <div className="text-sm text-blue-800 space-y-2">
                <p><strong>Como funciona:</strong></p>
                <ul className="list-disc list-inside space-y-1 ml-4">
                  <li>Los viajeros pagan un deposito + un cargo por servicio de la plataforma</li>
                  <li>La plataforma retiene el porcentaje de comision acordado por contrato</li>
                  <li>El pago a tu agencia se realiza automaticamente 3 dias despues de finalizar el tour</li>
                </ul>
                <p className="mt-3">
                  Asegurate de tener tu <strong>cuenta bancaria configurada en tu perfil</strong> para recibir los pagos sin retrasos.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Estadísticas principales */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Tours Activos</h2>
          <div className="flex items-center text-3xl font-bold text-primary-600">
            <MapPin className="h-8 w-8 mr-2" />
            <span>{stats.activeTours}</span>
          </div>
          <p className="text-gray-600 mt-2">
            {stats.totalTours} tours en total
          </p>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Reservas Recientes</h2>
          <div className="flex items-center text-3xl font-bold text-success-600">
            <Calendar className="h-8 w-8 mr-2" />
            <span>{stats.recentBookings}</span>
          </div>
          <p className="text-gray-600 mt-2">
            {stats.totalBookings} reservas en total
          </p>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Total de Viajeros</h2>
          <div className="flex items-center text-3xl font-bold text-accent-600">
            <Users className="h-8 w-8 mr-2" />
            <span>{stats.totalTravelers}</span>
          </div>
          <p className="text-gray-600 mt-2">Viajeros registrados en tus tours</p>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-xl font-semibold mb-4">Ingresos Netos</h2>
          <div className="flex items-center text-3xl font-bold text-secondary-600">
            <DollarSign className="h-8 w-8 mr-2" />
            <span>{formatCurrencyMXN(stats.totalRevenue)}</span>
          </div>
          <p className="text-gray-600 mt-2">
            {stats.pendingPayouts > 0 
              ? `$${formatCurrency(stats.pendingPayouts)} pendientes`
              : 'Después de comisiones'
            }
          </p>
        </div>
      </div>

      {/* Información sobre configuración de pagos */}
      {stats.totalRevenue === 0 && stats.totalBookings > 0 && (
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center">
            <CreditCard className="h-5 w-5 mr-2" />
            Pagos a tu Agencia
          </h2>
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <h3 className="font-medium text-yellow-900 mb-2">Como funciona el pago a tu agencia</h3>
            <div className="text-sm text-yellow-800 space-y-2">
              <p>
                Los pagos se realizan de forma <strong>automatica 3 dias despues de finalizar cada tour</strong>.
              </p>
              <p>
                Para recibirlos, asegurate de tener configurada tu <strong>cuenta bancaria en tu perfil de la plataforma</strong>.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Promocion Tours Destacados */}
      <div className="mb-8 rounded-2xl overflow-hidden shadow-sm border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-orange-50">
        {/* Header del banner */}
        <div className="bg-gradient-to-r from-amber-500 to-orange-500 px-6 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="bg-white/20 rounded-xl p-2">
              <Sparkles className="h-6 w-6 text-white" />
            </div>
            <div>
              <h2 className="text-white font-bold text-lg leading-tight">Tours Destacados</h2>
              <p className="text-amber-100 text-sm">Dale a tus tours la visibilidad que merecen</p>
            </div>
          </div>
          <a
            href="/agency/featured-tours"
            className="inline-flex items-center gap-2 bg-white text-amber-700 hover:bg-amber-50 font-semibold px-4 py-2 rounded-xl text-sm transition-colors shrink-0"
          >
            Ver mis destacados
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>

        {/* Beneficios */}
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-amber-100">
          {/* Beneficio 1 */}
          <div className="flex items-start gap-4 px-6 py-5">
            <div className="bg-amber-100 rounded-xl p-2.5 shrink-0 mt-0.5">
              <Eye className="h-5 w-5 text-amber-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 text-sm mb-1">Maxima Visibilidad</h3>
              <p className="text-gray-500 text-xs leading-relaxed">
                Tu tour aparece destacado en el <strong className="text-gray-700">hero principal</strong> y en los primeros lugares de los resultados de busqueda, captando la atencion de mas viajeros.
              </p>
            </div>
          </div>

          {/* Beneficio 2 */}
          <div className="flex items-start gap-4 px-6 py-5">
            <div className="bg-blue-100 rounded-xl p-2.5 shrink-0 mt-0.5">
              <BarChart2 className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 text-sm mb-1">Estadisticas en Tiempo Real</h3>
              <p className="text-gray-500 text-xs leading-relaxed">
                Accede a metricas detalladas: <strong className="text-gray-700">impresiones, clics y reservas generadas</strong>. Mide el retorno de tu inversion y optimiza tu estrategia.
              </p>
            </div>
          </div>

          {/* Beneficio 3 */}
          <div className="flex items-start gap-4 px-6 py-5">
            <div className="bg-green-100 rounded-xl p-2.5 shrink-0 mt-0.5">
              <Share2 className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900 text-sm mb-1">Difusion en Redes Sociales</h3>
              <p className="text-gray-500 text-xs leading-relaxed">
                Los tours destacados se <strong className="text-gray-700">comparten en las redes sociales de ToursRed</strong>, ampliando tu alcance a una audiencia aun mayor de forma organica.
              </p>
            </div>
          </div>
        </div>

        {/* CTA footer */}
        <div className="bg-amber-50 border-t border-amber-100 px-6 py-3 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-xs text-amber-700 font-medium">
            Planes desde precios accesibles — disponibles por tiempo y slots limitados.
          </p>
          <a
            href="/agency/tours"
            className="inline-flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold px-4 py-2 rounded-xl text-sm transition-colors"
          >
            <Sparkles className="h-4 w-4" />
            Destacar un Tour Ahora
          </a>
        </div>
      </div>

      {/* Preventas Activas */}
      {preventaStats.length > 0 && (
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 bg-amber-500 rounded-lg flex items-center justify-center">
              <Crown className="w-4 h-4 text-white" />
            </div>
            <h2 className="text-xl font-semibold text-gray-900">Tus Preventas</h2>
            <span className="text-xs font-semibold text-amber-700 bg-amber-100 px-2.5 py-1 rounded-full">
              {preventaStats.length} activa{preventaStats.length !== 1 ? 's' : ''}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {preventaStats.map((ps) => (
              <div
                key={ps.tourId}
                className={`bg-white rounded-xl shadow-sm border-2 p-5 ${
                  ps.beneficioAgotado ? 'border-gray-200' : 'border-amber-200'
                }`}
              >
                {/* Tour name + badge */}
                <div className="flex items-start justify-between gap-2 mb-4">
                  <h3 className="font-semibold text-gray-900 text-sm leading-snug line-clamp-2">
                    {ps.tourName}
                  </h3>
                  {ps.beneficioAgotado ? (
                    <span className="flex-shrink-0 text-xs font-semibold bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
                      Agotado
                    </span>
                  ) : (
                    <span className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-semibold bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                      <Crown className="w-3 h-3" />
                      Activa
                    </span>
                  )}
                </div>

                <div className="space-y-3">
                  {/* Reservas en preventa */}
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-gray-500 font-medium">Reservas en preventa</span>
                      <span className={`text-sm font-bold ${ps.beneficioAgotado ? 'text-gray-500' : 'text-amber-700'}`}>
                        {ps.reservasCount} / 10
                      </span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all duration-500 ${
                          ps.beneficioAgotado ? 'bg-gray-400' : 'bg-amber-400'
                        }`}
                        style={{ width: `${Math.min(100, (ps.reservasCount / 10) * 100)}%` }}
                      />
                    </div>
                  </div>

                  {/* Beneficio */}
                  <div className="flex items-center justify-between py-2 border-t border-gray-100">
                    <div className="flex items-center gap-1.5">
                      <Tag className="w-3.5 h-3.5 text-gray-400" />
                      <span className="text-xs text-gray-500">Beneficio aplicado</span>
                    </div>
                    <span className={`text-xs font-semibold ${ps.beneficioAgotado ? 'text-gray-400 line-through' : 'text-emerald-700'}`}>
                      10% descuento en comisión
                    </span>
                  </div>

                  {/* Ahorro acumulado */}
                  <div className="flex items-center justify-between py-2 border-t border-gray-100">
                    <div className="flex items-center gap-1.5">
                      <DollarSign className="w-3.5 h-3.5 text-gray-400" />
                      <span className="text-xs text-gray-500">Ahorro acumulado</span>
                    </div>
                    <span className="text-sm font-bold text-emerald-600">
                      {formatCurrencyMXN(ps.ahorroAcumulado)}
                    </span>
                  </div>

                  {/* Tiempo restante */}
                  <div className="flex items-center justify-between py-2 border-t border-gray-100">
                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5 text-gray-400" />
                      <span className="text-xs text-gray-500">Tiempo restante</span>
                    </div>
                    <span className={`text-sm font-bold ${
                      ps.diasRestantes <= 3 ? 'text-red-600' : ps.diasRestantes <= 7 ? 'text-amber-600' : 'text-gray-700'
                    }`}>
                      {ps.diasRestantes === 0
                        ? 'Último día'
                        : `${ps.diasRestantes} día${ps.diasRestantes !== 1 ? 's' : ''}`}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actividad Reciente */}
      <div className="bg-white rounded-lg shadow p-6">
        <h2 className="text-xl font-semibold mb-4 flex items-center">
          <Activity className="h-5 w-5 mr-2" />
          Actividad Reciente
        </h2>
        
        {stats.recentActivity.length > 0 ? (
          <div className="space-y-4">
            {stats.recentActivity.map((activity) => (
              <div key={activity.id} className="flex items-start space-x-3 p-3 bg-gray-50 rounded-lg">
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
                    {' '}para {activity.travelers_count} {activity.travelers_count === 1 ? 'viajero' : 'viajeros'}
                  </div>
                  <div className="flex items-center mt-1 space-x-2">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getStatusColor(activity.status)}`}>
                      {getStatusText(activity.status)}
                    </span>
                    <span className="text-xs text-gray-500">
                      {new Date(activity.created_at).toLocaleDateString('es-ES')}
                    </span>
                    <span className="text-xs text-gray-500">
                      {formatCurrencyMXN(activity.deposit_amount ?? 0)} depósito
                    </span>
                    {activity.payment_status === 'succeeded' && (
                      <span className="text-xs text-green-600 font-medium">
                        ✓ Pagado
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <Activity className="h-8 w-8 text-gray-400 mx-auto mb-2" />
            <p className="text-gray-500">No hay actividad reciente para mostrar.</p>
            <p className="text-sm text-gray-400 mt-1">
              Las reservas de tus tours aparecerán aquí.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default AgencyDashboard;