import React, { useEffect, useState } from 'react';
import { Star, ThumbsUp, Flag } from 'lucide-react';
import { Review } from '../types';
import { getTourReviews } from '../lib/supabase';

interface ReviewListProps {
  tourId: string;
}

const ReviewItem: React.FC<{ review: Review }> = ({ review }) => {
  const renderStars = (rating: number) => {
    return Array.from({ length: 5 }).map((_, index) => (
      <Star
        key={index}
        className={`h-4 w-4 ${
          index < rating ? 'text-yellow-400 fill-current' : 'text-gray-300'
        }`}
      />
    ));
  };

  return (
    <div className="border-b border-gray-200 py-4 last:border-0">
      <div className="flex justify-between items-start">
        <div className="flex items-center">
          <div className="font-medium">
            {review.users?.first_name} {review.users?.last_name?.charAt(0)}.
          </div>
          <div className="flex ml-2">{renderStars(review.rating)}</div>
        </div>
        <div className="text-sm text-gray-500">
          {new Date(review.created_at).toLocaleDateString()}
        </div>
      </div>
      
      <p className="mt-2 text-gray-700">{review.comment}</p>
      
      {review.reply && (
        <div className="mt-3 pl-4 border-l-2 border-gray-200">
          <div className="font-medium text-sm">Respuesta de la Agencia:</div>
          <p className="mt-1 text-sm text-gray-700">{review.reply}</p>
        </div>
      )}
      
      <div className="mt-3 flex space-x-4">
        <button className="flex items-center text-sm text-gray-500 hover:text-gray-700">
          <ThumbsUp className="h-4 w-4 mr-1" />
          <span>Útil</span>
        </button>
        <button className="flex items-center text-sm text-gray-500 hover:text-error-600">
          <Flag className="h-4 w-4 mr-1" />
          <span>Reportar</span>
        </button>
      </div>
    </div>
  );
};

const ReviewList: React.FC<ReviewListProps> = ({ tourId }) => {
  const [reviews, setReviews] = useState<Review[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchReviews = async () => {
      try {
        setIsLoading(true);
        const { data, error } = await getTourReviews(tourId);
        
        if (error) {
          throw new Error(error.message);
        }
        
        setReviews(data || []);
      } catch (err: any) {
        setError(err.message || 'Error al cargar las reseñas');
      } finally {
        setIsLoading(false);
      }
    };

    fetchReviews();
  }, [tourId]);

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8 text-error-600">
        {error}
      </div>
    );
  }

  if (reviews.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        No hay reseñas todavía. ¡Sé el primero en dejar una reseña!
      </div>
    );
  }

  return (
    <div className="divide-y divide-gray-200">
      {reviews.map((review) => (
        <ReviewItem key={review.id} review={review} />
      ))}
    </div>
  );
};

export default ReviewList;