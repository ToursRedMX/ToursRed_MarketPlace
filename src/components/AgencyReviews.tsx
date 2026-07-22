import { useEffect, useState } from 'react';
import { Star, User, Calendar, MessageSquare } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

interface Review {
  id: string;
  rating: number;
  comment: string;
  created_at: string;
  reply: string | null;
  traveler: {
    first_name: string;
    last_name: string;
  };
}

interface AgencyReviewsProps {
  agencyId: string;
  agencyName: string;
}

export default function AgencyReviews({ agencyId, agencyName }: AgencyReviewsProps) {
  const { user } = useAuth();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [averageRating, setAverageRating] = useState(0);
  const [totalReviews, setTotalReviews] = useState(0);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [canReview, setCanReview] = useState(false);
  const [hasReviewed, setHasReviewed] = useState(false);

  useEffect(() => {
    fetchReviews();
    if (user && user.role === 'traveler') {
      checkCanReview();
    }
  }, [agencyId, user]);

  const fetchReviews = async () => {
    try {
      const { data, error } = await supabase
        .rpc('get_agency_reviews_with_users', { p_agency_id: agencyId });

      if (error) {
        console.error('Error en query de reseñas:', error);
        throw error;
      }

      const reviewsData = data || [];

      const reviewsWithTravelers = reviewsData.map(review => ({
        id: review.id,
        rating: review.rating,
        comment: review.comment,
        reply: review.reply,
        created_at: review.created_at,
        traveler: {
          first_name: review.traveler_first_name || 'Usuario',
          last_name: review.traveler_last_name || ''
        }
      }));

      setReviews(reviewsWithTravelers);
      setTotalReviews(reviewsWithTravelers.length);

      if (reviewsWithTravelers.length > 0) {
        const avg = reviewsWithTravelers.reduce((sum, review) => sum + review.rating, 0) / reviewsWithTravelers.length;
        setAverageRating(avg);
      } else {
        setAverageRating(0);
      }
    } catch (error) {
      console.error('Error cargando reseñas:', error);
      setError('Error al cargar las reseñas');
    } finally {
      setLoading(false);
    }
  };

  const checkCanReview = async () => {
    if (!user) return;

    try {
      const { data: existingReview } = await supabase
        .from('agency_reviews')
        .select('id')
        .eq('agency_id', agencyId)
        .eq('traveler_id', user.id)
        .maybeSingle();

      if (existingReview) {
        setHasReviewed(true);
        return;
      }

      const { data: completedBookings } = await supabase
        .from('bookings')
        .select('id')
        .eq('agency_id', agencyId)
        .eq('user_id', user.id)
        .eq('status', 'confirmed')
        .limit(1);

      setCanReview((completedBookings || []).length > 0);
    } catch (err) {
      console.error('Error verificando permisos:', err);
    }
  };

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user) {
      setError('Debes iniciar sesión');
      return;
    }

    if (!comment.trim()) {
      setError('Escribe un comentario');
      return;
    }

    try {
      setIsSubmitting(true);
      setError('');

      const { data: booking } = await supabase
        .from('bookings')
        .select('id')
        .eq('agency_id', agencyId)
        .eq('user_id', user.id)
        .eq('status', 'confirmed')
        .limit(1)
        .maybeSingle();

      if (!booking) {
        setError('Necesitas una reserva confirmada para reseñar');
        return;
      }

      const { error: insertError } = await supabase
        .from('agency_reviews')
        .insert({
          agency_id: agencyId,
          traveler_id: user.id,
          booking_id: booking.id,
          rating,
          comment: comment.trim(),
          is_visible: true,
        });

      if (insertError) throw insertError;

      setComment('');
      setRating(5);
      setShowReviewForm(false);
      setHasReviewed(true);
      setCanReview(false);
      fetchReviews();
    } catch (err: any) {
      setError(err.message || 'Error al enviar reseña');
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('es-MX', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const renderStars = (rating: number, interactive: boolean = false, onRate?: (r: number) => void) => {
    return (
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <Star
            key={star}
            className={`w-5 h-5 ${
              star <= rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300'
            } ${interactive ? 'cursor-pointer hover:text-yellow-400' : ''}`}
            onClick={() => interactive && onRate && onRate(star)}
          />
        ))}
      </div>
    );
  };

  const getRatingDistribution = () => {
    const distribution = [0, 0, 0, 0, 0];
    reviews.forEach((review) => {
      distribution[review.rating - 1]++;
    });
    return distribution;
  };

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
      </div>
    );
  }

  if (error && reviews.length === 0) {
    return (
      <div className="bg-red-50 border border-red-200 text-red-700 px-6 py-4 rounded-lg">
        <p className="font-medium">Error al cargar las reseñas</p>
        <p className="text-sm mt-1">Por favor, intenta recargar la página</p>
      </div>
    );
  }

  const ratingDistribution = getRatingDistribution();

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow p-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <div className="text-center md:col-span-1">
            <div className="text-5xl font-bold text-gray-900 mb-2">
              {averageRating > 0 ? averageRating.toFixed(1) : '0.0'}
            </div>
            {renderStars(Math.round(averageRating))}
            <p className="text-gray-600 mt-2">{totalReviews} reseñas</p>
          </div>

          <div className="md:col-span-2">
            {[5, 4, 3, 2, 1].map((stars) => (
              <div key={stars} className="flex items-center mb-2">
                <span className="text-sm text-gray-600 w-12">{stars} estrellas</span>
                <div className="flex-1 mx-4 bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-yellow-400 h-2 rounded-full"
                    style={{
                      width: `${totalReviews > 0 ? (ratingDistribution[stars - 1] / totalReviews) * 100 : 0}%`,
                    }}
                  />
                </div>
                <span className="text-sm text-gray-600 w-12 text-right">
                  {ratingDistribution[stars - 1]}
                </span>
              </div>
            ))}
          </div>
        </div>

        {user && user.role === 'traveler' && canReview && !hasReviewed && (
          <div className="border-t pt-6">
            {!showReviewForm ? (
              <button
                onClick={() => setShowReviewForm(true)}
                className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 transition-colors"
              >
                Escribir una reseña
              </button>
            ) : (
              <form onSubmit={handleSubmitReview} className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-900">
                  Deja tu reseña sobre {agencyName}
                </h3>

                {error && (
                  <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
                    {error}
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Calificación
                  </label>
                  {renderStars(rating, true, setRating)}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Tu experiencia
                  </label>
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    rows={4}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="Cuéntanos sobre tu experiencia con esta agencia..."
                    required
                  />
                </div>

                <div className="flex space-x-3">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex-1 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
                  >
                    {isSubmitting ? 'Enviando...' : 'Publicar reseña'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowReviewForm(false);
                      setComment('');
                      setRating(5);
                      setError('');
                    }}
                    className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {user && user.role === 'traveler' && hasReviewed && (
          <div className="border-t pt-6">
            <div className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded">
              Ya has dejado una reseña para esta agencia
            </div>
          </div>
        )}

        {!user && (
          <div className="border-t pt-6">
            <div className="bg-gray-50 border border-gray-200 text-gray-700 px-4 py-3 rounded text-center">
              <a href="/login" className="text-blue-600 hover:text-blue-700 font-medium">
                Inicia sesión
              </a>{' '}
              como viajero para dejar una reseña
            </div>
          </div>
        )}
      </div>

      <div className="space-y-4">
        {reviews.length > 0 ? (
          reviews.filter(review => review.traveler).map((review) => (
            <div key={review.id} className="bg-white rounded-lg shadow p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-start space-x-3">
                  <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                    <User className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <h4 className="font-semibold text-gray-900">
                      {review.traveler?.first_name || 'Usuario'} {review.traveler?.last_name || ''}
                    </h4>
                    <div className="flex items-center text-sm text-gray-600 mt-1">
                      <Calendar className="h-4 w-4 mr-1" />
                      {formatDate(review.created_at)}
                    </div>
                  </div>
                </div>
                {renderStars(review.rating)}
              </div>

              <p className="text-gray-700 whitespace-pre-wrap">{review.comment}</p>

              {review.reply && (
                <div className="mt-4 pl-4 border-l-4 border-blue-200 bg-blue-50 p-4 rounded">
                  <div className="flex items-center text-sm text-blue-900 font-medium mb-2">
                    <MessageSquare className="h-4 w-4 mr-2" />
                    Respuesta de {agencyName}
                  </div>
                  <p className="text-blue-800 text-sm">{review.reply}</p>
                </div>
              )}
            </div>
          ))
        ) : (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <Star className="h-16 w-16 text-gray-400 mx-auto mb-4" />
            <h3 className="text-xl font-semibold text-gray-900 mb-2">
              No hay reseñas todavía
            </h3>
            <p className="text-gray-600">
              Sé el primero en compartir tu experiencia con esta agencia
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
