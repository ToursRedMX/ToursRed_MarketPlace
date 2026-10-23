import { useCallback, useEffect, useState } from 'react';
import { Star, Building, Flag, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { comoFilas } from '../lib/relacionesSupabase';
import { mensajeDeError } from '../lib/errores';

interface TravelerReview {
  id: string;
  rating: number;
  comment: string;
  created_at: string;
  apelada_en: string | null;
  apelacion_resultado: 'mantenida' | 'ocultada' | null;
  apelacion_ticket: { folio: string } | null;
  agency: {
    name: string;
    logo?: string;
  };
  booking: {
    tour: {
      name: string;
    };
  };
}

interface TravelerReviewsDisplayProps {
  travelerId: string;
  solicitanteNombre?: string;
  solicitanteEmail?: string;
}

export default function TravelerReviewsDisplay({ travelerId, solicitanteNombre, solicitanteEmail }: TravelerReviewsDisplayProps) {
  const [reviews, setReviews] = useState<TravelerReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [averageRating, setAverageRating] = useState(0);
  const [apelando, setApelando] = useState<TravelerReview | null>(null);
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [errorApelacion, setErrorApelacion] = useState('');

  const fetchReviews = useCallback(async () => {
    try {
      console.log('🔍 [TravelerReviews] Fetching reviews for traveler:', travelerId);

      const { data, error } = await supabase
        .from('traveler_reviews')
        .select(`
          id,
          rating,
          comment,
          created_at,
          apelada_en,
          apelacion_resultado,
          apelacion_ticket:support_tickets!traveler_reviews_apelacion_ticket_id_fkey(folio),
          agency:agencies!traveler_reviews_agency_id_fkey(
            name,
            logo
          ),
          booking:bookings!traveler_reviews_booking_id_fkey(
            tour:tours(name)
          )
        `)
        .eq('traveler_id', travelerId)
        .order('created_at', { ascending: false });

      console.log('📊 [TravelerReviews] Query result:', { data, error });

      if (error) {
        console.error('❌ [TravelerReviews] Error fetching reviews:', error);
        throw error;
      }

      const reviewsData = data || [];
      console.log('✅ [TravelerReviews] Reviews data:', reviewsData);
      setReviews(comoFilas<TravelerReview>(reviewsData));

      if (reviewsData.length > 0) {
        const avg = reviewsData.reduce((sum, review) => sum + review.rating, 0) / reviewsData.length;
        setAverageRating(avg);
        console.log('⭐ [TravelerReviews] Average rating:', avg);
      }
    } catch (error) {
      console.error('❌ [TravelerReviews] Exception:', error);
    } finally {
      setLoading(false);
    }
  }, [travelerId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchReviews();
  }, [fetchReviews]);

  // La apelacion es un ticket de soporte normal (folio y correos) ligado a la
  // calificacion; la base comprueba que el ticket sea del viajero y de ESTA calificacion.
  const enviarApelacion = async () => {
    if (!apelando) return;
    setEnviando(true);
    setErrorApelacion('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Tu sesión expiró. Vuelve a iniciar sesión.');

      const { data: subcategoria, error: errorSub } = await supabase
        .from('support_subcategories')
        .select('id')
        .eq('nomenclatura', 'CAL')
        .eq('activa', true)
        .maybeSingle();
      if (errorSub || !subcategoria) throw new Error('No encontramos el tipo de solicitud. Intenta más tarde.');

      const respuesta = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/support-create-ticket`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          tipo: 'traveler',
          subcategory_id: subcategoria.id,
          solicitante_nombre: solicitanteNombre || session.user.email,
          solicitante_email: solicitanteEmail || session.user.email,
          descripcion: `Apelación de calificación de "${apelando.agency.name}" (${apelando.rating} estrellas, tour "${apelando.booking.tour.name}").\n\nMotivo: ${motivo.trim()}`,
          user_id: session.user.id,
          extra_data: { motivo: 'apelacion_calificacion', review_id: apelando.id },
        }),
      });
      const ticket = await respuesta.json();
      if (!respuesta.ok) throw new Error(ticket.error ?? 'No se pudo crear la solicitud');

      const { data: vinculo, error: errorVinculo } = await supabase.rpc('apelar_calificacion_viajero', {
        p_review_id: apelando.id,
        p_ticket_id: ticket.ticket_id,
      });
      if (errorVinculo) throw errorVinculo;
      if (!vinculo?.success) throw new Error(vinculo?.error ?? 'No se pudo registrar la apelación');

      setApelando(null);
      setMotivo('');
      await fetchReviews();
    } catch (err) {
      console.error('Error apelando la calificación:', err);
      setErrorApelacion(mensajeDeError(err) || 'No se pudo enviar la solicitud de revisión.');
    } finally {
      setEnviando(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('es-MX', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const renderStars = (rating: number) => {
    return (
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={`w-4 h-4 ${
              star <= rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'
            }`}
          />
        ))}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">
        Mis Calificaciones de Agencias
      </h2>

      {reviews.length > 0 && (
        <div className="bg-gradient-to-r from-blue-50 to-cyan-50 p-4 rounded-lg border border-blue-100 mb-6">
          <div className="flex items-center gap-3">
            <span className="text-3xl font-bold text-gray-900">
              {averageRating.toFixed(1)}
            </span>
            <div>
              {renderStars(Math.round(averageRating))}
              <p className="text-sm text-gray-600 mt-1">
                {reviews.length} {reviews.length === 1 ? 'calificación' : 'calificaciones'}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {reviews.length === 0 ? (
          <div className="text-center py-12 bg-gray-50 rounded-lg">
            <Star className="w-12 h-12 text-gray-400 mx-auto mb-3" />
            <p className="text-gray-600">Aún no has recibido calificaciones</p>
            <p className="text-sm text-gray-500 mt-2">
              Las agencias podrán calificarte después de completar un tour
            </p>
          </div>
        ) : (
          reviews.map((review) => (
            <div
              key={review.id}
              className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0">
                  {review.agency.logo ? (
                    <img
                      src={review.agency.logo}
                      alt={review.agency.name}
                      className="w-12 h-12 rounded-full object-cover"
                    />
                  ) : (
                    <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-cyan-600 rounded-full flex items-center justify-center">
                      <Building className="w-6 h-6 text-white" />
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <h4 className="font-semibold text-gray-900">{review.agency.name}</h4>
                      <p className="text-sm text-gray-500">{review.booking.tour.name}</p>
                    </div>
                    {renderStars(review.rating)}
                  </div>
                  {review.comment && (
                    <p className="text-gray-700 leading-relaxed mt-2">{review.comment}</p>
                  )}
                  <p className="text-xs text-gray-500 mt-2">{formatDate(review.created_at)}</p>
                  {review.apelada_en ? (
                    <p className="text-xs mt-2 text-amber-700">
                      {review.apelacion_resultado === 'mantenida'
                        ? `Soporte revisó tu solicitud y la calificación se mantuvo${review.apelacion_ticket ? ` (folio ${review.apelacion_ticket.folio})` : ''}.`
                        : `Solicitaste revisión de esta calificación${review.apelacion_ticket ? ` (folio ${review.apelacion_ticket.folio})` : ''}. Soporte la está revisando.`}
                    </p>
                  ) : (
                    <button
                      type="button"
                      onClick={() => { setApelando(review); setMotivo(''); setErrorApelacion(''); }}
                      className="mt-2 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-red-600"
                    >
                      <Flag className="h-3 w-3" />
                      Solicitar revisión
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {apelando && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg max-w-lg w-full p-6">
            <div className="flex justify-between items-start mb-3">
              <h3 className="text-lg font-semibold">Solicitar revisión de una calificación</h3>
              <button type="button" onClick={() => setApelando(null)} className="text-gray-400 hover:text-gray-600" aria-label="Cerrar">
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-3">
              {apelando.agency.name} te calificó con {apelando.rating} {apelando.rating === 1 ? 'estrella' : 'estrellas'}. Cuéntanos por qué crees que debe revisarse; soporte la revisará y podrá ocultarla.
            </p>
            <textarea
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              rows={4}
              maxLength={1000}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="Explica qué pasó (mínimo 20 caracteres)"
            />
            {errorApelacion && <p className="text-sm text-red-700 mt-2">{errorApelacion}</p>}
            <div className="flex gap-3 mt-4">
              <button
                type="button"
                onClick={enviarApelacion}
                disabled={enviando || motivo.trim().length < 20}
                className="flex-1 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
              >
                {enviando ? 'Enviando...' : 'Enviar a soporte'}
              </button>
              <button type="button" onClick={() => setApelando(null)} disabled={enviando} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-sm text-blue-800">
          <strong>Nota:</strong> Estas calificaciones las ven solo tú y las agencias de ToursRed; no son públicas.
        </p>
      </div>
    </div>
  );
}
