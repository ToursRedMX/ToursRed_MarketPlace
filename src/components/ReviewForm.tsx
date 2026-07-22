import { useState, useEffect } from 'react';
import { Star } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useFormPersistence } from '../hooks/useFormPersistence';
import { usePreventUnload } from '../hooks/usePreventUnload';

interface ReviewFormProps {
  bookingId: string;
  revieweeId: string;
  reviewType: 'agency' | 'traveler';
  onSuccess?: () => void;
  onCancel?: () => void;
  existingReview?: {
    id: string;
    rating: number;
    comment: string;
  };
}

export default function ReviewForm({
  bookingId,
  revieweeId,
  reviewType,
  onSuccess,
  onCancel,
  existingReview
}: ReviewFormProps) {
  const [rating, setRating] = useState(existingReview?.rating || 0);
  const [hoveredRating, setHoveredRating] = useState(0);
  const [comment, setComment] = useState(existingReview?.comment || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const reviewFormPersistence = useFormPersistence(
    { rating, comment },
    { key: `review_${bookingId}_${revieweeId}`, expirationHours: 24 }
  );

  usePreventUnload(comment.length > 0 || rating > 0);

  useEffect(() => {
    if (!existingReview) {
      const savedData = reviewFormPersistence.loadFromStorage();
      if (savedData) {
        reviewFormPersistence.setIsRestoring(true);
        if (savedData.rating) setRating(savedData.rating);
        if (savedData.comment) setComment(savedData.comment);
        setTimeout(() => reviewFormPersistence.setIsRestoring(false), 100);
      }
    }
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (rating === 0) {
      setError('Por favor selecciona una calificación');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No autenticado');

      const table = reviewType === 'agency' ? 'agency_reviews' : 'traveler_reviews';

      let reviewData: any = {
        booking_id: bookingId,
        rating,
        comment: comment.trim()
      };

      if (reviewType === 'agency') {
        reviewData.agency_id = revieweeId;
        reviewData.traveler_id = user.id;
      } else {
        const { data: agencyData } = await supabase
          .from('agencies')
          .select('id')
          .eq('user_id', user.id)
          .single();

        if (!agencyData) throw new Error('Agencia no encontrada');

        reviewData.traveler_id = revieweeId;
        reviewData.agency_id = agencyData.id;
      }

      if (existingReview) {
        const { error: updateError } = await supabase
          .from(table)
          .update({ rating, comment: comment.trim() })
          .eq('id', existingReview.id);

        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase
          .from(table)
          .insert([reviewData]);

        if (insertError) throw insertError;
      }

      reviewFormPersistence.clearStorage();
      if (onSuccess) onSuccess();
    } catch (err: any) {
      console.error('Error submitting review:', err);
      setError(err.message || 'Error al enviar la reseña');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Calificación
        </label>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              onClick={() => setRating(star)}
              onMouseEnter={() => setHoveredRating(star)}
              onMouseLeave={() => setHoveredRating(0)}
              className="focus:outline-none transition-transform hover:scale-110"
            >
              <Star
                className={`w-8 h-8 ${
                  star <= (hoveredRating || rating)
                    ? 'fill-yellow-400 text-yellow-400'
                    : 'text-gray-300'
                }`}
              />
            </button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="comment" className="block text-sm font-medium text-gray-700 mb-2">
          Comentario {reviewType === 'agency' ? '(público)' : '(privado)'}
        </label>
        <textarea
          id="comment"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={4}
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          placeholder={
            reviewType === 'agency'
              ? 'Comparte tu experiencia con otros viajeros...'
              : 'Comparte tu experiencia con este viajero...'
          }
        />
        <p className="mt-1 text-sm text-gray-500">
          {reviewType === 'agency'
            ? 'Tu comentario será visible para todos los usuarios'
            : 'Tu comentario solo será visible para ti y el viajero'}
        </p>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
          <p className="text-sm text-red-800">{error}</p>
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={loading || rating === 0}
          className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Enviando...' : existingReview ? 'Actualizar Reseña' : 'Enviar Reseña'}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={() => {
              reviewFormPersistence.clearStorage();
              onCancel();
            }}
            disabled={loading}
            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}
