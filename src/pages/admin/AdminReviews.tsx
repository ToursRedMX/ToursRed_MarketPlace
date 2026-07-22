import React, { useState, useEffect } from 'react';
import { Star, Search, Filter, Eye, EyeOff, MessageSquare, Trash2, Flag, Calendar, User, Building, MapPin, MoreVertical, AlertTriangle, CheckCircle, XCircle, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { format } from 'date-fns';

interface AdminReview {
  id: string;
  user_id?: string;
  tour_id?: string;
  agency_id: string;
  traveler_id?: string;
  booking_id?: string;
  rating: number;
  comment: string;
  reply?: string;
  is_visible: boolean;
  created_at: string;
  updated_at: string;
  review_type: 'tour' | 'agency' | 'traveler';
  user_first_name?: string;
  user_last_name?: string;
  user_email?: string;
  tour_name?: string;
  tour_destination?: string;
  tour_image_url?: string;
  agency_name?: string;
}

const AdminReviews: React.FC = () => {
  const [reviews, setReviews] = useState<AdminReview[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [ratingFilter, setRatingFilter] = useState<'all' | '1' | '2' | '3' | '4' | '5'>('all');
  const [visibilityFilter, setVisibilityFilter] = useState<'all' | 'visible' | 'hidden'>('all');
  const [selectedReview, setSelectedReview] = useState<AdminReview | null>(null);
  const [isUpdating, setIsUpdating] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [isReplying, setIsReplying] = useState<string | null>(null);

  useEffect(() => {
    fetchReviews();
  }, []);

  const fetchReviews = async () => {
    try {
      setIsLoading(true);
      setError('');

      const { data, error } = await supabase
        .from('admin_reviews_view')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        throw error;
      }

      setReviews(data || []);
    } catch (err: any) {
      console.error('❌ Error cargando reseñas:', err);
      setError(err.message || 'Error al cargar las reseñas');
    } finally {
      setIsLoading(false);
    }
  };

  const handleToggleVisibility = async (reviewId: string, currentVisibility: boolean, reviewType: 'tour' | 'agency' | 'traveler') => {
    try {
      setIsUpdating(reviewId);
      setError('');

      const tableName = reviewType === 'tour' ? 'reviews' :
                       reviewType === 'agency' ? 'agency_reviews' :
                       'traveler_reviews';

      const { error } = await supabase
        .from(tableName)
        .update({
          is_visible: !currentVisibility,
          updated_at: new Date().toISOString()
        })
        .eq('id', reviewId);

      if (error) {
        throw new Error(error.message);
      }

      // Actualizar estado local
      setReviews(reviews.map(review =>
        review.id === reviewId
          ? { ...review, is_visible: !currentVisibility }
          : review
      ));

      console.log(`✅ Visibilidad de reseña ${reviewId} actualizada a:`, !currentVisibility);
    } catch (err: any) {
      console.error('❌ Error actualizando visibilidad:', err);
      setError(err.message || 'Error al actualizar la visibilidad');
    } finally {
      setIsUpdating(null);
    }
  };

  const handleDeleteReview = async (review: AdminReview) => {
    const reviewTypeLabel = review.review_type === 'tour' ? 'Tour' :
                           review.review_type === 'agency' ? 'Agencia' : 'Viajero';

    if (!confirm(`¿Estás seguro de que quieres eliminar esta reseña?\n\nTipo: Reseña de ${reviewTypeLabel}\nDe: ${getUserDisplayName(review)}\nCalificación: ${review.rating} estrellas\n\nEsta acción NO se puede deshacer.`)) {
      return;
    }

    try {
      setIsUpdating(review.id);
      setError('');

      const tableName = review.review_type === 'tour' ? 'reviews' :
                       review.review_type === 'agency' ? 'agency_reviews' :
                       'traveler_reviews';

      const { error } = await supabase
        .from(tableName)
        .delete()
        .eq('id', review.id);

      if (error) {
        throw new Error(error.message);
      }

      // Actualizar estado local
      setReviews(reviews.filter(r => r.id !== review.id));
      console.log('✅ Reseña eliminada correctamente');
    } catch (err: any) {
      console.error('❌ Error eliminando reseña:', err);
      setError(err.message || 'Error al eliminar la reseña');
    } finally {
      setIsUpdating(null);
    }
  };

  const handleAddReply = async (reviewId: string, reviewType: 'tour' | 'agency' | 'traveler') => {
    if (!replyText.trim()) {
      setError('La respuesta no puede estar vacía');
      return;
    }

    try {
      setIsUpdating(reviewId);
      setError('');

      const tableName = reviewType === 'tour' ? 'reviews' :
                       reviewType === 'agency' ? 'agency_reviews' :
                       'traveler_reviews';

      // Solo reviews y agency_reviews tienen reply
      if (reviewType === 'traveler') {
        setError('Las reseñas de viajeros no soportan respuestas');
        return;
      }

      const { error } = await supabase
        .from(tableName)
        .update({
          reply: replyText.trim(),
          updated_at: new Date().toISOString()
        })
        .eq('id', reviewId);

      if (error) {
        throw new Error(error.message);
      }

      // Actualizar estado local
      setReviews(reviews.map(review =>
        review.id === reviewId
          ? { ...review, reply: replyText.trim() }
          : review
      ));

      setReplyText('');
      setIsReplying(null);
      console.log('✅ Respuesta agregada correctamente');
    } catch (err: any) {
      console.error('❌ Error agregando respuesta:', err);
      setError(err.message || 'Error al agregar la respuesta');
    } finally {
      setIsUpdating(null);
    }
  };

  const getUserDisplayName = (review: AdminReview) => {
    if (review.review_type === 'traveler') {
      return review.agency_name || 'Agencia';
    }

    if (review.user_first_name || review.user_last_name) {
      return `${review.user_first_name || ''} ${review.user_last_name || ''}`.trim();
    }

    if (review.user_email) {
      return review.user_email;
    }

    return 'Usuario';
  };

  const getReviewTypeLabel = (reviewType: 'tour' | 'agency' | 'traveler') => {
    switch (reviewType) {
      case 'tour':
        return 'Reseña de Tour';
      case 'agency':
        return 'Reseña de Agencia';
      case 'traveler':
        return 'Reseña de Viajero';
      default:
        return 'Reseña';
    }
  };

  const getReviewTypeBadge = (reviewType: 'tour' | 'agency' | 'traveler') => {
    const colors = {
      tour: 'bg-blue-100 text-blue-800',
      agency: 'bg-green-100 text-green-800',
      traveler: 'bg-purple-100 text-purple-800'
    };

    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colors[reviewType]}`}>
        {getReviewTypeLabel(reviewType)}
      </span>
    );
  };

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

  const getVisibilityBadge = (isVisible: boolean) => {
    if (isVisible) {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-success-100 text-success-800">
          <Eye className="h-3 w-3 mr-1" />
          Visible
        </span>
      );
    } else {
      return (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-error-100 text-error-800">
          <EyeOff className="h-3 w-3 mr-1" />
          Oculta
        </span>
      );
    }
  };

  const getRatingColor = (rating: number) => {
    if (rating >= 4) return 'text-green-600';
    if (rating >= 3) return 'text-yellow-600';
    return 'text-red-600';
  };

  const filteredReviews = reviews.filter(review => {
    const matchesSearch =
      getUserDisplayName(review).toLowerCase().includes(searchTerm.toLowerCase()) ||
      review.comment.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (review.tour_name && review.tour_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (review.tour_destination && review.tour_destination.toLowerCase().includes(searchTerm.toLowerCase())) ||
      (review.agency_name && review.agency_name.toLowerCase().includes(searchTerm.toLowerCase()));

    const matchesRating = ratingFilter === 'all' || review.rating.toString() === ratingFilter;

    const matchesVisibility =
      visibilityFilter === 'all' ||
      (visibilityFilter === 'visible' && review.is_visible) ||
      (visibilityFilter === 'hidden' && !review.is_visible);

    return matchesSearch && matchesRating && matchesVisibility;
  });

  const stats = {
    total: reviews.length,
    visible: reviews.filter(r => r.is_visible).length,
    hidden: reviews.filter(r => !r.is_visible).length,
    withReply: reviews.filter(r => r.reply).length,
    averageRating: reviews.length > 0 
      ? Math.round((reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length) * 10) / 10
      : 0,
    lowRatings: reviews.filter(r => r.rating <= 2).length
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
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Gestión de Reseñas</h1>
          <p className="text-gray-600 mt-1">
            Modera y gestiona todas las reseñas de tours en la plataforma
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-6 bg-error-50 text-error-600 p-4 rounded-md flex items-start">
          <AlertTriangle className="h-5 w-5 mr-2 mt-0.5 flex-shrink-0" />
          <div>
            <p className="font-medium">Error</p>
            <p className="text-sm">{error}</p>
          </div>
        </div>
      )}

      {/* Estadísticas */}
      <div className="grid grid-cols-1 md:grid-cols-6 gap-4 mb-6">
        <div className="bg-white rounded-lg shadow-md p-4">
          <div className="text-2xl font-bold text-primary-600">{stats.total}</div>
          <div className="text-sm text-gray-500">Total Reseñas</div>
        </div>
        <div className="bg-white rounded-lg shadow-md p-4">
          <div className="text-2xl font-bold text-success-600">{stats.visible}</div>
          <div className="text-sm text-gray-500">Visibles</div>
        </div>
        <div className="bg-white rounded-lg shadow-md p-4">
          <div className="text-2xl font-bold text-error-600">{stats.hidden}</div>
          <div className="text-sm text-gray-500">Ocultas</div>
        </div>
        <div className="bg-white rounded-lg shadow-md p-4">
          <div className="text-2xl font-bold text-blue-600">{stats.withReply}</div>
          <div className="text-sm text-gray-500">Con Respuesta</div>
        </div>
        <div className="bg-white rounded-lg shadow-md p-4">
          <div className="text-2xl font-bold text-yellow-600">{stats.averageRating}</div>
          <div className="text-sm text-gray-500">Promedio</div>
        </div>
        <div className="bg-white rounded-lg shadow-md p-4">
          <div className="text-2xl font-bold text-orange-600">{stats.lowRatings}</div>
          <div className="text-sm text-gray-500">≤ 2 Estrellas</div>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-lg shadow-md p-4 mb-6">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Buscar por usuario, tour, agencia o comentario..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10 pr-4 py-2 w-full border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <Filter className="h-4 w-4 text-gray-400" />
              <select
                value={ratingFilter}
                onChange={(e) => setRatingFilter(e.target.value as any)}
                className="border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              >
                <option value="all">Todas las calificaciones</option>
                <option value="5">5 estrellas</option>
                <option value="4">4 estrellas</option>
                <option value="3">3 estrellas</option>
                <option value="2">2 estrellas</option>
                <option value="1">1 estrella</option>
              </select>
            </div>
            <div className="flex items-center space-x-2">
              <select
                value={visibilityFilter}
                onChange={(e) => setVisibilityFilter(e.target.value as any)}
                className="border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              >
                <option value="all">Todas</option>
                <option value="visible">Solo visibles</option>
                <option value="hidden">Solo ocultas</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Lista de Reseñas */}
      {filteredReviews.length === 0 ? (
        <div className="bg-white rounded-lg shadow-md p-8 text-center">
          <Star className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-xl font-semibold mb-2">
            {reviews.length === 0 ? 'No hay reseñas registradas' : 'No se encontraron reseñas'}
          </h3>
          <p className="text-gray-600">
            {reviews.length === 0 
              ? 'Las reseñas aparecerán aquí cuando los usuarios completen tours y dejen comentarios.'
              : 'Intenta ajustar los filtros de búsqueda.'
            }
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {filteredReviews.map((review) => (
            <div key={review.id} className="bg-white rounded-lg shadow-md overflow-hidden">
              <div className="p-6">
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-start space-x-4">
                    {/* Tour Image */}
                    <div className="flex-shrink-0">
                      <img
                        src={review.tour_image_url || 'https://images.pexels.com/photos/1271619/pexels-photo-1271619.jpeg'}
                        alt={review.tour_name || 'Tour'}
                        className="w-16 h-16 rounded-lg object-cover"
                      />
                    </div>

                    {/* Review Info */}
                    <div className="flex-1">
                      <div className="flex items-center space-x-2 mb-2">
                        <h3 className="text-lg font-semibold text-gray-900">
                          {review.tour_name || 'Sin nombre'}
                        </h3>
                        {getReviewTypeBadge(review.review_type)}
                        {getVisibilityBadge(review.is_visible)}
                      </div>

                      <div className="flex items-center space-x-4 text-sm text-gray-600 mb-2">
                        <div className="flex items-center">
                          <MapPin className="h-4 w-4 mr-1" />
                          <span>{review.tour_destination || 'Destino no especificado'}</span>
                        </div>
                        <div className="flex items-center">
                          <Building className="h-4 w-4 mr-1" />
                          <span>{review.agency_name || 'Agencia no especificada'}</span>
                        </div>
                      </div>
                      
                      <div className="flex items-center space-x-4 text-sm text-gray-600">
                        <div className="flex items-center">
                          <User className="h-4 w-4 mr-1" />
                          <span>{getUserDisplayName(review)}</span>
                        </div>
                        <div className="flex items-center">
                          <Calendar className="h-4 w-4 mr-1" />
                          <span>{format(new Date(review.created_at), 'dd/MM/yyyy HH:mm')}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  {/* Actions */}
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => handleToggleVisibility(review.id, review.is_visible, review.review_type)}
                      disabled={isUpdating === review.id}
                      className={`inline-flex items-center px-3 py-1 rounded-md text-xs font-medium ${
                        review.is_visible
                          ? 'bg-error-100 text-error-700 hover:bg-error-200'
                          : 'bg-success-100 text-success-700 hover:bg-success-200'
                      } disabled:opacity-50`}
                    >
                      {isUpdating === review.id ? (
                        <div className="animate-spin rounded-full h-3 w-3 border-t border-b border-current mr-1"></div>
                      ) : review.is_visible ? (
                        <EyeOff className="h-3 w-3 mr-1" />
                      ) : (
                        <Eye className="h-3 w-3 mr-1" />
                      )}
                      {review.is_visible ? 'Ocultar' : 'Mostrar'}
                    </button>
                    
                    <button
                      onClick={() => handleDeleteReview(review)}
                      disabled={isUpdating === review.id}
                      className="text-error-600 hover:text-error-900 disabled:opacity-50"
                      title="Eliminar reseña"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* Rating and Comment */}
                <div className="mb-4">
                  <div className="flex items-center space-x-2 mb-3">
                    <div className="flex">{renderStars(review.rating)}</div>
                    <span className={`font-semibold ${getRatingColor(review.rating)}`}>
                      {review.rating}/5
                    </span>
                    <span className="text-sm text-gray-500">
                      ({review.rating === 5 ? 'Excelente' : 
                        review.rating === 4 ? 'Muy bueno' : 
                        review.rating === 3 ? 'Bueno' : 
                        review.rating === 2 ? 'Regular' : 'Malo'})
                    </span>
                  </div>
                  
                  <div className="bg-gray-50 rounded-lg p-4">
                    <p className="text-gray-800 whitespace-pre-wrap">{review.comment}</p>
                  </div>
                </div>

                {/* Agency Reply */}
                {review.reply ? (
                  <div className="bg-blue-50 border-l-4 border-blue-400 p-4 mb-4">
                    <div className="flex items-center mb-2">
                      <MessageSquare className="h-4 w-4 text-blue-600 mr-2" />
                      <span className="text-sm font-medium text-blue-900">
                        Respuesta de {review.agency_name}:
                      </span>
                    </div>
                    <p className="text-blue-800 text-sm whitespace-pre-wrap">{review.reply}</p>
                  </div>
                ) : (
                  <div className="border-t pt-4">
                    {isReplying === review.id ? (
                      <div className="space-y-3">
                        <div className="flex items-center text-sm text-gray-600 mb-2">
                          <MessageSquare className="h-4 w-4 mr-2" />
                          <span>Agregar respuesta como administrador:</span>
                        </div>
                        <textarea
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          placeholder="Escribe una respuesta profesional a esta reseña..."
                          className="w-full p-3 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                          rows={3}
                        />
                        <div className="flex justify-end space-x-2">
                          <button
                            onClick={() => {
                              setIsReplying(null);
                              setReplyText('');
                            }}
                            className="btn btn-outline btn-sm"
                            disabled={isUpdating === review.id}
                          >
                            Cancelar
                          </button>
                          <button
                            onClick={() => handleAddReply(review.id, review.review_type)}
                            className="btn btn-primary btn-sm"
                            disabled={isUpdating === review.id || !replyText.trim() || review.review_type === 'traveler'}
                          >
                            {isUpdating === review.id ? (
                              <>
                                <div className="animate-spin rounded-full h-3 w-3 border-t-2 border-b-2 border-white mr-1"></div>
                                Enviando...
                              </>
                            ) : (
                              <>
                                <MessageSquare className="h-3 w-3 mr-1" />
                                Enviar Respuesta
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    ) : review.review_type !== 'traveler' ? (
                      <button
                        onClick={() => setIsReplying(review.id)}
                        className="text-primary-600 hover:text-primary-800 text-sm font-medium flex items-center"
                      >
                        <MessageSquare className="h-4 w-4 mr-1" />
                        Agregar respuesta
                      </button>
                    ) : (
                      <p className="text-sm text-gray-500 italic">
                        Las reseñas de viajeros no soportan respuestas
                      </p>
                    )}
                  </div>
                )}

                {/* Review Metadata */}
                <div className="border-t pt-4 mt-4">
                  <div className="flex items-center justify-between text-xs text-gray-500">
                    <div className="flex items-center space-x-4">
                      <span>ID: {review.id.slice(0, 8)}...</span>
                      <span>
                        {review.review_type === 'traveler'
                          ? `Agencia: ${review.agency_name}`
                          : `Usuario: ${review.user_email}`}
                      </span>
                      {review.updated_at !== review.created_at && (
                        <span>Actualizado: {format(new Date(review.updated_at), 'dd/MM/yyyy HH:mm')}</span>
                      )}
                    </div>
                    <div className="flex items-center space-x-2">
                      {review.rating <= 2 && (
                        <span className="flex items-center text-orange-600">
                          <Flag className="h-3 w-3 mr-1" />
                          Calificación baja
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal de Detalles (opcional para futuras mejoras) */}
      {selectedReview && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-full max-w-2xl shadow-lg rounded-md bg-white">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium text-gray-900">Detalles de la Reseña</h3>
              <button 
                onClick={() => setSelectedReview(null)} 
                className="text-gray-400 hover:text-gray-600"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-medium text-gray-700">Usuario:</span>
                  <div className="text-gray-600">{getUserDisplayName(selectedReview)}</div>
                  <div className="text-gray-500">{selectedReview.user_email}</div>
                </div>
                <div>
                  <span className="font-medium text-gray-700">Tour:</span>
                  <div className="text-gray-600">{selectedReview.tour_name}</div>
                  <div className="text-gray-500">{selectedReview.tour_destination}</div>
                </div>
                <div>
                  <span className="font-medium text-gray-700">Agencia:</span>
                  <div className="text-gray-600">{selectedReview.agency_name}</div>
                </div>
                <div>
                  <span className="font-medium text-gray-700">Fecha:</span>
                  <div className="text-gray-600">
                    {format(new Date(selectedReview.created_at), 'dd/MM/yyyy HH:mm')}
                  </div>
                </div>
              </div>

              <div>
                <span className="font-medium text-gray-700">Calificación:</span>
                <div className="flex items-center mt-1">
                  {renderStars(selectedReview.rating)}
                  <span className="ml-2 font-semibold">{selectedReview.rating}/5</span>
                </div>
              </div>

              <div>
                <span className="font-medium text-gray-700">Comentario:</span>
                <div className="mt-1 p-3 bg-gray-50 rounded-md">
                  <p className="text-gray-800 whitespace-pre-wrap">{selectedReview.comment}</p>
                </div>
              </div>

              {selectedReview.reply && (
                <div>
                  <span className="font-medium text-gray-700">Respuesta de la Agencia:</span>
                  <div className="mt-1 p-3 bg-blue-50 rounded-md">
                    <p className="text-blue-800 whitespace-pre-wrap">{selectedReview.reply}</p>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end mt-6">
              <button
                onClick={() => setSelectedReview(null)}
                className="btn btn-outline"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminReviews;