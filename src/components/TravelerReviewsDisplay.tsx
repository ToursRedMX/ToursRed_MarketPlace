import { useEffect, useState } from 'react';
import { Star, Building } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface TravelerReview {
  id: string;
  rating: number;
  comment: string;
  created_at: string;
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
}

export default function TravelerReviewsDisplay({ travelerId }: TravelerReviewsDisplayProps) {
  const [reviews, setReviews] = useState<TravelerReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [averageRating, setAverageRating] = useState(0);

  useEffect(() => {
    fetchReviews();
  }, [travelerId]);

  const fetchReviews = async () => {
    try {
      console.log('🔍 [TravelerReviews] Fetching reviews for traveler:', travelerId);

      const { data, error } = await supabase
        .from('traveler_reviews')
        .select(`
          id,
          rating,
          comment,
          created_at,
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
      setReviews(reviewsData);

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
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-sm text-blue-800">
          <strong>Nota:</strong> Solo tú puedes ver estas calificaciones. Las agencias podrán verlas cuando reserves un tour con ellas.
        </p>
      </div>
    </div>
  );
}
