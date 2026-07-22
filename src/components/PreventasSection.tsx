import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Crown, Clock, MapPin, Building, Tag, ArrowRight, Lock } from 'lucide-react';
import { Tour } from '../types';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { formatCurrency } from '../utils/formatCurrency';

interface PreventaTour extends Tour {
  agencies?: { name: string; rating?: number };
  dias_restantes: number;
}

function useMembershipStatus(userId: string | undefined) {
  const [hasMembership, setHasMembership] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) { setLoading(false); return; }
    supabase
      .from('memberships')
      .select('status, current_period_end')
      .eq('user_id', userId)
      .in('status', ['active', 'cancelled'])
      .maybeSingle()
      .then(({ data }) => {
        const isActive = !!data && (
          data.status === 'active' ||
          (data.status === 'cancelled' && data.current_period_end && new Date(data.current_period_end) > new Date())
        );
        setHasMembership(isActive);
        setLoading(false);
      });
  }, [userId]);

  return { hasMembership, loading };
}

const CountdownBadge: React.FC<{ dias: number }> = ({ dias }) => {
  if (dias <= 0) return null;
  const color = dias <= 3 ? 'bg-red-100 text-red-700 border-red-200' : dias <= 7 ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-emerald-100 text-emerald-700 border-emerald-200';
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${color}`}>
      <Clock className="w-3 h-3" />
      {dias === 1 ? 'Último día' : `${dias} días`}
    </span>
  );
};

const PreventasSection: React.FC = () => {
  const [tours, setTours] = useState<PreventaTour[]>([]);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const { hasMembership } = useMembershipStatus(user?.id);

  useEffect(() => {
    const fetchPreventaTours = async () => {
      const today = new Date().toISOString().split('T')[0];
      const { data, error } = await supabase
        .from('tours')
        .select('*, agencies(name, rating)')
        .eq('preventa_activa', true)
        .lte('preventa_inicio', today)
        .gte('preventa_fin', today)
        .order('preventa_fin', { ascending: true })
        .limit(6);

      if (!error && data) {
        const toursWithDays = data.map((t: any) => {
          const fin = new Date(t.preventa_fin + 'T23:59:59');
          const diff = Math.ceil((fin.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
          return { ...t, dias_restantes: Math.max(0, diff) };
        });
        setTours(toursWithDays);
      }
      setLoading(false);
    };
    fetchPreventaTours();
  }, []);

  if (loading || tours.length === 0) return null;

  const getPrecioBase = (tour: PreventaTour): number => {
    if (!tour.preventa_precio_especial || !tour.preventa_descuento_valor) return tour.price;
    if (tour.preventa_tipo_descuento === 'porcentaje') return tour.price * (1 - tour.preventa_descuento_valor / 100);
    return Math.max(0, tour.price - tour.preventa_descuento_valor);
  };

  return (
    <section className="py-12 bg-gradient-to-br from-amber-50 via-orange-50 to-amber-100">
      <div className="container-custom">
        {/* Header */}
        <div className="flex items-start justify-between mb-8 gap-4">
          <div className="flex items-center gap-4">
            <div className="flex-shrink-0 w-12 h-12 bg-amber-500 rounded-xl flex items-center justify-center shadow-md">
              <Crown className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <h2 className="text-2xl md:text-3xl font-bold text-gray-900">Preventas Exclusivas</h2>
                <span className="hidden sm:inline-flex items-center px-2.5 py-0.5 rounded-full bg-amber-500 text-white text-xs font-bold uppercase tracking-wide">
                  ToursRed Plus
                </span>
              </div>
              <p className="text-gray-600 text-sm md:text-base">
                Acceso anticipado y precios especiales para socios con membresía activa
              </p>
            </div>
          </div>
          {!hasMembership && (
            <Link
              to="/traveler/membership"
              className="hidden md:flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors flex-shrink-0"
            >
              <Crown className="w-4 h-4" />
              Obtener Plus
            </Link>
          )}
        </div>

        {/* Tours grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {tours.map((tour) => {
            const precioBase = getPrecioBase(tour);
            const tieneDescuento = tour.preventa_precio_especial && tour.preventa_descuento_valor && precioBase < tour.price;

            return (
              <div key={tour.id} className="group bg-white rounded-2xl shadow-sm hover:shadow-xl transition-all duration-300 overflow-hidden border border-amber-100">
                {/* Image */}
                <div className="relative h-44 overflow-hidden">
                  <img
                    src={tour.image_url}
                    alt={tour.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

                  {/* Top badges */}
                  <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
                    <span className="inline-flex items-center gap-1 bg-amber-500 text-white text-xs font-bold px-2.5 py-1 rounded-full shadow">
                      <Crown className="w-3 h-3" />
                      Preventa
                    </span>
                    {tieneDescuento && (
                      <span className="inline-flex items-center gap-1 bg-emerald-500 text-white text-xs font-bold px-2.5 py-1 rounded-full shadow">
                        <Tag className="w-3 h-3" />
                        {tour.preventa_tipo_descuento === 'porcentaje'
                          ? `-${tour.preventa_descuento_valor}%`
                          : `-$${tour.preventa_descuento_valor}`
                        }
                      </span>
                    )}
                  </div>

                  {/* Countdown bottom */}
                  <div className="absolute bottom-3 right-3">
                    <CountdownBadge dias={tour.dias_restantes} />
                  </div>

                  {/* Lock overlay for non-members */}
                  {!hasMembership && (
                    <div className="absolute inset-0 bg-black/30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                      <div className="bg-white/95 rounded-xl px-4 py-3 text-center shadow-lg">
                        <Lock className="w-5 h-5 text-amber-600 mx-auto mb-1" />
                        <p className="text-xs font-semibold text-gray-800">Solo socios ToursRed Plus</p>
                        <Link to="/traveler/membership" className="text-xs text-amber-600 hover:text-amber-700 font-medium">
                          Obtener membresía
                        </Link>
                      </div>
                    </div>
                  )}
                </div>

                {/* Content */}
                <div className="p-4">
                  <h3 className="font-bold text-gray-900 mb-1.5 line-clamp-1 group-hover:text-amber-700 transition-colors">
                    {tour.name}
                  </h3>

                  <div className="flex items-center gap-1 text-gray-500 text-xs mb-1">
                    <MapPin className="w-3 h-3 flex-shrink-0" />
                    <span className="truncate">{tour.destination}</span>
                  </div>

                  {tour.agencies?.name && (
                    <div className="flex items-center gap-1 text-gray-400 text-xs mb-3">
                      <Building className="w-3 h-3 flex-shrink-0" />
                      <span className="truncate">{tour.agencies.name}</span>
                    </div>
                  )}

                  {/* Price */}
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-gray-400 mb-0.5">Precio desde</p>
                      {tieneDescuento ? (
                        <div className="flex items-baseline gap-2">
                          <span className="text-xl font-bold text-amber-600">{formatCurrency(precioBase)}</span>
                          <span className="text-sm text-gray-400 line-through">{formatCurrency(tour.price)}</span>
                        </div>
                      ) : (
                        <span className="text-xl font-bold text-gray-900">{formatCurrency(tour.price)}</span>
                      )}
                      {tieneDescuento && !hasMembership && (
                        <p className="text-xs text-amber-600 mt-0.5">Con membresía Plus</p>
                      )}
                    </div>

                    <Link
                      to={`/tours/${tour.slug}`}
                      className="flex items-center gap-1 bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
                    >
                      Ver tour
                      <ArrowRight className="w-3 h-3" />
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* CTA for non-members */}
        {!hasMembership && (
          <div className="mt-8 bg-white border border-amber-200 rounded-2xl p-6 flex flex-col md:flex-row items-center justify-between gap-4 shadow-sm">
            <div className="flex items-center gap-4 text-center md:text-left">
              <div className="flex-shrink-0 w-12 h-12 bg-amber-100 rounded-xl flex items-center justify-center">
                <Crown className="w-6 h-6 text-amber-600" />
              </div>
              <div>
                <p className="font-bold text-gray-900 mb-0.5">Únete a ToursRed Plus para reservar en preventa</p>
                <p className="text-sm text-gray-500">Acceso anticipado, precios exclusivos y sin cargo por servicio en tours nacionales</p>
              </div>
            </div>
            <Link
              to="/traveler/membership"
              className="flex-shrink-0 flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white font-semibold px-6 py-3 rounded-xl transition-colors shadow-md"
            >
              <Crown className="w-4 h-4" />
              Obtener ToursRed Plus
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        )}
      </div>
    </section>
  );
};

export default PreventasSection;
