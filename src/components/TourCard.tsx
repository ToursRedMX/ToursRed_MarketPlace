import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Calendar, Star, Users, Building, Heart, Tag, RefreshCw, Crown, Sparkles } from 'lucide-react';
import { Tour } from '../types';
import { useAuth } from '../context/AuthContext';
import { supabase, trackFeaturedImpression, trackFeaturedClick } from '../lib/supabase';
import { formatCurrency } from '../utils/formatCurrency';

interface TourPromo {
  promotion_type: string;
  min_travelers: number;
  fixed_group_price: number | null;
  group_discount_percentage: number | null;
  max_uses: number | null;
  times_used: number;
}

interface TourCardProps {
  tour: Tour & {
    distance_meters?: number;
    nearest_departure_location?: string;
    nearest_departure_address?: string;
  };
  className?: string;
  showDistance?: boolean;
  activePromo?: TourPromo | null;
  compact?: boolean;
  isFeaturedTour?: boolean;
  featuredSlotId?: string;
}

const TourCard: React.FC<TourCardProps> = ({
  tour, className = '', showDistance = false, activePromo = null,
  compact = false, isFeaturedTour = false, featuredSlotId,
}) => {
  const { user } = useAuth();
  const [isSaved, setIsSaved] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const cardRef = useRef<HTMLDivElement | HTMLAnchorElement>(null);
  const impressionTracked = useRef(false);

  // Track impression only when card enters viewport (IntersectionObserver)
  useEffect(() => {
    if (!isFeaturedTour || !featuredSlotId || impressionTracked.current) return;
    const el = cardRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !impressionTracked.current) {
          impressionTracked.current = true;
          trackFeaturedImpression(featuredSlotId);
          observer.disconnect();
        }
      },
      { threshold: 0.5 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [isFeaturedTour, featuredSlotId]);

  const handleFeaturedClick = useCallback(() => {
    if (isFeaturedTour && featuredSlotId) {
      sessionStorage.setItem('featuredReferral', featuredSlotId);
      trackFeaturedClick(featuredSlotId);
    }
  }, [isFeaturedTour, featuredSlotId]);

  const formatDistance = (meters: number) => {
    const km = meters / 1000;
    if (km < 1) {
      return `${Math.round(meters)} m`;
    }
    return `${km.toFixed(1)} km`;
  };

  const getDistanceBadgeColor = (meters: number) => {
    const km = meters / 1000;
    if (km < 2) return 'bg-green-100 text-green-800 border-green-300';
    if (km < 5) return 'bg-yellow-100 text-yellow-800 border-yellow-300';
    return 'bg-orange-100 text-orange-800 border-orange-300';
  };

  useEffect(() => {
    if (user) {
      checkIfSaved();
    }
  }, [user, tour.id]);

  const checkIfSaved = async () => {
    if (!user) return;

    const { data } = await supabase
      .from('saved_tours')
      .select('id')
      .eq('user_id', user.id)
      .eq('tour_id', tour.id)
      .maybeSingle();

    setIsSaved(!!data);
  };

  const handleSaveToggle = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!user) {
      alert('Debes iniciar sesión para guardar tours');
      return;
    }

    setIsSaving(true);

    try {
      if (isSaved) {
        const { error } = await supabase
          .from('saved_tours')
          .delete()
          .eq('user_id', user.id)
          .eq('tour_id', tour.id);

        if (error) throw error;
        setIsSaved(false);
      } else {
        const { error } = await supabase
          .from('saved_tours')
          .insert({
            user_id: user.id,
            tour_id: tour.id
          });

        if (error) throw error;
        setIsSaved(true);
      }
    } catch (error) {
      console.error('Error saving tour:', error);
      alert('Error al guardar el tour');
    } finally {
      setIsSaving(false);
    }
  };
  // Helper function to format dates consistently
  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return '';
    try {
      const [year, month, day] = dateString.split('-').map(Number);
      const date = new Date(Date.UTC(year, month - 1, day));
      const monthName = date.toLocaleString('es-MX', { month: 'short', timeZone: 'UTC' });
      const dayNum = date.toLocaleString('es-MX', { day: 'numeric', timeZone: 'UTC' });
      const yearNum = date.toLocaleString('es-MX', { year: 'numeric', timeZone: 'UTC' });
      return `${dayNum} ${monthName.replace('.', '')} ${yearNum}`;
    } catch {
      return dateString;
    }
  };

  if (compact) {
    const today = new Date().toISOString().split('T')[0];
    const isEnPreventa = !!(tour.preventa_activa && tour.preventa_inicio && tour.preventa_inicio <= today && tour.preventa_fin && tour.preventa_fin >= today);
    const precioFinal = isEnPreventa && tour.preventa_precio_especial && tour.preventa_descuento_valor
      ? (tour.preventa_tipo_descuento === 'porcentaje'
          ? tour.price * (1 - (tour.preventa_descuento_valor ?? 0) / 100)
          : Math.max(0, tour.price - (tour.preventa_descuento_valor ?? 0)))
      : null;

    return (
      <Link
        ref={cardRef as React.RefObject<HTMLAnchorElement>}
        to={`/tours/${tour.slug}`}
        onClick={handleFeaturedClick}
        className={`group bg-white rounded-xl shadow-sm border overflow-hidden flex flex-col transition-all hover:shadow-md hover:-translate-y-0.5 animate-fade-in ${
          isFeaturedTour ? 'border-amber-300 ring-1 ring-amber-200' : 'border-gray-100'
        } ${className}`}
      >
        <div className="relative overflow-hidden aspect-[3/4]">
          <img
            src={tour.image_url || 'https://images.pexels.com/photos/2245436/pexels-photo-2245436.png'}
            alt={tour.name}
            loading="lazy"
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
          {/* Badges */}
          <div className="absolute top-1.5 left-1.5 flex flex-col gap-1">
            {isFeaturedTour && (
              <span className="bg-gradient-to-r from-amber-400 to-amber-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded leading-none flex items-center gap-0.5 shadow-sm">
                <Sparkles className="w-2 h-2" />
                Destacado
              </span>
            )}
            {!isFeaturedTour && tour.is_featured && (
              <span className="bg-accent-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded leading-none">Dest.</span>
            )}
            {activePromo && (
              <span className={`text-white text-[9px] font-bold px-1.5 py-0.5 rounded leading-none flex items-center gap-0.5 ${
                activePromo.promotion_type === '2x1' ? 'bg-rose-600' : activePromo.promotion_type === '3x2' ? 'bg-orange-500' : 'bg-emerald-600'
              }`}>
                <Tag className="w-2 h-2" />
                {activePromo.promotion_type === '2x1' ? '2x1' : activePromo.promotion_type === '3x2' ? '3x2' : 'Oferta'}
              </span>
            )}
            {isEnPreventa && (
              <span className="bg-amber-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded leading-none flex items-center gap-0.5">
                <Crown className="w-2 h-2" />
                Preventa
              </span>
            )}
          </div>
          {tour.tour_type === 'receptivo' && (
            <span className={`absolute top-1.5 right-1.5 text-white text-[9px] font-bold px-1.5 py-0.5 rounded leading-none ${
              (tour as any).activity_type === 'experience' ? 'bg-violet-600'
              : (tour as any).activity_type === 'transport' ? 'bg-blue-600'
              : (tour as any).activity_type === 'ticket' ? 'bg-orange-600'
              : 'bg-teal-600'
            }`}>
              {(tour as any).activity_type === 'experience' ? 'Exp.'
                : (tour as any).activity_type === 'transport' ? 'Traslado'
                : (tour as any).activity_type === 'ticket' ? 'Entrada'
                : 'Recep.'}
            </span>
          )}
        </div>
        <div className="p-2.5 flex flex-col flex-1">
          <h3 className="text-xs font-semibold text-gray-900 line-clamp-2 leading-snug mb-1.5 flex-1">{tour.name}</h3>
          <div className="flex items-center gap-1 text-gray-500 mb-1.5">
            <MapPin className="w-3 h-3 flex-shrink-0" />
            <span className="text-[10px] truncate">{tour.destination}</span>
          </div>
          <div className="flex items-center justify-between mt-auto pt-1.5 border-t border-gray-100">
            <div>
              {precioFinal ? (
                <div>
                  <span className="text-amber-600 font-bold text-sm">${precioFinal.toFixed(0)}</span>
                  <span className="text-gray-400 line-through text-[10px] ml-1">${tour.price}</span>
                </div>
              ) : (
                <span className="text-primary-600 font-bold text-sm">${tour.price}</span>
              )}
            </div>
            <div className="flex items-center gap-0.5 text-accent-500">
              <Star className="w-3 h-3 fill-current" />
              <span className="text-[10px] font-medium">{tour.agencies?.rating?.toFixed(1) || '4.5'}</span>
            </div>
          </div>
        </div>
      </Link>
    );
  }

  return (
    <div
      ref={cardRef as React.RefObject<HTMLDivElement>}
      className={`bg-white rounded-2xl shadow-sm border overflow-hidden transition-all hover:shadow-md hover:-translate-y-0.5 group animate-fade-in ${
        isFeaturedTour ? 'border-amber-300 ring-1 ring-amber-200' : 'border-gray-100'
      } ${className}`}
    >
      <Link to={`/tours/${tour.slug}`} onClick={handleFeaturedClick} className="block">
      <div className="relative overflow-hidden aspect-[4/3]">
        <img
          src={tour.image_url || 'https://images.pexels.com/photos/2245436/pexels-photo-2245436.png'}
          alt={tour.name}
          loading="lazy"
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        />
        {isFeaturedTour && (
          <div className="absolute top-2 left-2 bg-gradient-to-r from-amber-400 to-amber-500 text-white text-xs font-semibold px-2.5 py-1 rounded-full shadow-sm flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            Tour Destacado
          </div>
        )}
        {!isFeaturedTour && tour.is_featured && (
          <div className="absolute top-2 left-2 bg-accent-500 text-white text-xs font-semibold px-2 py-1 rounded">
            Destacado
          </div>
        )}
        {tour.tour_type === 'receptivo' && (
          <div className={`absolute ${(isFeaturedTour || tour.is_featured) ? 'top-9' : 'top-2'} left-2 flex items-center gap-1 bg-teal-600 text-white text-[10px] font-bold px-2 py-1 rounded shadow-sm`}>
            <RefreshCw className="w-2.5 h-2.5" />
            {tour.receptivo_modality === 'privado' ? 'Privado' : 'Receptivo'}
          </div>
        )}
        {activePromo && (
          <div className={`absolute left-2 flex items-center gap-1 text-white text-xs font-bold px-2 py-1 rounded shadow-md ${
            (isFeaturedTour || tour.is_featured) && tour.tour_type === 'receptivo' ? 'top-16' :
            (isFeaturedTour || tour.is_featured) || tour.tour_type === 'receptivo' ? 'top-9' : 'top-2'
          } ${
            activePromo.promotion_type === '2x1' ? 'bg-rose-600' :
            activePromo.promotion_type === '3x2' ? 'bg-orange-500' :
            activePromo.promotion_type === 'nxprecio' ? 'bg-teal-600' :
            'bg-emerald-600'
          }`}>
            <Tag className="w-3 h-3" />
            {activePromo.promotion_type === '2x1' ? '2x1' :
             activePromo.promotion_type === '3x2' ? '3x2' :
             activePromo.promotion_type === 'nxprecio' && activePromo.fixed_group_price !== null
               ? `${activePromo.min_travelers} x $${formatCurrency(activePromo.fixed_group_price)}`
             : activePromo.promotion_type === 'grupo_precio_fijo' && activePromo.group_discount_percentage !== null
               ? `-${activePromo.group_discount_percentage}% Grupal`
               : 'Oferta'}
          </div>
        )}
        {(() => {
          const today = new Date().toISOString().split('T')[0];
          const isEnPreventa = !!(
            tour.preventa_activa &&
            tour.preventa_inicio && tour.preventa_inicio <= today &&
            tour.preventa_fin && tour.preventa_fin >= today
          );
          if (!isEnPreventa) return null;
          const badgesCount = ((isFeaturedTour || tour.is_featured) ? 1 : 0) + (tour.tour_type === 'receptivo' ? 1 : 0) + (activePromo ? 1 : 0);
          const topOffset = badgesCount === 0 ? 'top-2' : badgesCount === 1 ? 'top-9' : badgesCount === 2 ? 'top-16' : 'top-[5.75rem]';
          return (
            <div className={`absolute left-2 ${topOffset} flex items-center gap-1 bg-amber-500 text-white text-[10px] font-bold px-2 py-1 rounded shadow-sm`}>
              <Crown className="w-2.5 h-2.5" />
              Preventa
            </div>
          );
        })()}
        {user && (
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleSaveToggle(e); }}
            disabled={isSaving}
            className="absolute top-2 right-2 p-2 bg-white rounded-full shadow-md hover:shadow-lg transition-all disabled:opacity-50"
            title={isSaved ? 'Quitar de guardados' : 'Guardar tour'}
          >
            <Heart
              className={`w-5 h-5 transition-all ${
                isSaved ? 'fill-red-500 text-red-500' : 'text-gray-600 hover:text-red-500'
              }`}
            />
          </button>
        )}
      </div>
      </Link>

      <div className="p-4">
        <div className="flex justify-between items-start mb-2">
          <h3 className="text-lg font-semibold text-gray-900 line-clamp-1">{tour.name}</h3>
          <div className="flex items-center text-accent-500">
            <Star className="w-4 h-4 fill-current" />
            <span className="ml-1 text-sm font-medium">
              {tour.agencies?.rating?.toFixed(1) || '4.5'}
            </span>
          </div>
        </div>

        <div className="space-y-2 mb-2">
          <div className="flex items-center text-gray-500 text-sm">
            <MapPin className="w-4 h-4 mr-1" />
            <span>{tour.destination}</span>
          </div>

          {showDistance && tour.distance_meters !== undefined && (
            <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${getDistanceBadgeColor(tour.distance_meters)}`}>
              <MapPin className="w-3.5 h-3.5" />
              <span>
                A {formatDistance(tour.distance_meters)} de tu búsqueda
              </span>
            </div>
          )}

          {showDistance && tour.nearest_departure_location && (
            <div className="text-xs text-gray-600 flex items-start gap-1">
              <MapPin className="w-3 h-3 mt-0.5 flex-shrink-0" />
              <span className="line-clamp-1">
                Sale desde: <span className="font-medium">{tour.nearest_departure_location}</span>
              </span>
            </div>
          )}
        </div>

        {tour.agencies && (
          <div className="flex items-center text-gray-600 text-sm mb-2">
            <Building className="w-4 h-4 mr-1" />
            <Link
              to={`/agencies/${tour.agency_id}`}
              className="hover:text-blue-600 hover:underline transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              {tour.agencies.name}
            </Link>
          </div>
        )}

        {tour.tour_type === 'receptivo' ? (
          <div className="flex items-center text-gray-500 text-sm mb-3">
            <RefreshCw className="w-4 h-4 mr-1 text-teal-600" />
            <span className="text-teal-700">Disponible según calendario</span>
          </div>
        ) : (
          <div className="flex items-center text-gray-500 text-sm mb-3">
            <Calendar className="w-4 h-4 mr-1" />
            <span>{formatDate(tour.start_date)} - {formatDate(tour.end_date)}</span>
          </div>
        )}

        {tour.max_travelers && (
          <div className="flex items-center text-gray-500 text-sm mb-3">
            <Users className="w-4 h-4 mr-1" />
            <span>Máximo {tour.max_travelers} viajeros</span>
          </div>
        )}

        <div className="border-t border-gray-100 pt-3 flex items-center justify-between">
          <div>
            <span className="text-sm text-gray-500">Desde</span>
            {(() => {
              const today = new Date().toISOString().split('T')[0];
              const isEnPreventa = !!(tour.preventa_activa && tour.preventa_inicio && tour.preventa_inicio <= today && tour.preventa_fin && tour.preventa_fin >= today);
              const tieneDescuento = isEnPreventa && tour.preventa_precio_especial && tour.preventa_descuento_valor;
              if (!tieneDescuento) return <div className="text-primary-600 font-bold text-xl">${tour.price}</div>;
              const precioBase = tour.preventa_tipo_descuento === 'porcentaje'
                ? tour.price * (1 - (tour.preventa_descuento_valor ?? 0) / 100)
                : Math.max(0, tour.price - (tour.preventa_descuento_valor ?? 0));
              return (
                <div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-amber-600 font-bold text-xl">${precioBase.toFixed(0)}</span>
                    <span className="text-gray-400 line-through text-sm">${tour.price}</span>
                  </div>
                  <p className="text-xs text-amber-600">Con membresía Plus</p>
                </div>
              );
            })()}
          </div>

          <Link to={`/tours/${tour.slug}`} onClick={handleFeaturedClick} className="btn btn-primary">
            Ver Detalles
          </Link>
        </div>
      </div>
    </div>
  );
};

export default TourCard;