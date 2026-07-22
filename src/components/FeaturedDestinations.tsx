import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MapPin } from 'lucide-react';
import { supabase } from '../lib/supabase';

interface Destination {
  id: string;
  name: string;
  tour_count: number;
  sample_image?: string;
  main_image_url?: string;
}

const FeaturedDestinations: React.FC = () => {
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchPopularDestinations = async () => {
      try {
        console.log('🌍 Cargando destinos populares desde la BD...');
        
        // Get destinations with tour counts and images (OPTIMIZED: no base64)
        const { data, error } = await supabase
          .from('destinations')
          .select(`
            id,
            name,
            main_image_url,
            tour_destinations(
              tours(id, image_url, end_date, tour_type)
            )
          `)
          .eq('is_active', true)
          .limit(50);
        
        if (error) {
          console.error('❌ Error cargando destinos:', error);
          setDestinations([]);
          return;
        }
        
        if (!data || data.length === 0) {
          console.log('📭 No hay destinos en la BD');
          setDestinations([]);
          return;
        }
        
        // Process destinations and count tours
        const today = new Date().toISOString().split('T')[0];
        const processedDestinations = data
          .map(dest => {
            const tours = (dest.tour_destinations?.map(td => td.tours).filter(Boolean) || [])
              .filter(tour => tour.tour_type === 'receptivo' || !tour.end_date || tour.end_date >= today);
            return {
              id: dest.id,
              name: dest.name,
              main_image_url: dest.main_image_url,
              tour_count: tours.length,
              sample_image: tours[0]?.image_url || 'https://images.pexels.com/photos/1271619/pexels-photo-1271619.jpeg'
            };
          })
          .filter(dest => dest.tour_count > 0) // Only show destinations with tours
          .sort((a, b) => b.tour_count - a.tour_count) // Sort by tour count
          .slice(0, 4); // Take top 4
        
        console.log('✅ Destinos populares procesados:', processedDestinations);
        setDestinations(processedDestinations);
        
      } catch (err: any) {
        console.error('❌ Error en fetchPopularDestinations:', err);
        setDestinations([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchPopularDestinations();
  }, []);

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (destinations.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-md p-8 text-center">
        <h3 className="text-xl font-semibold mb-2">¡Destinos en Camino!</h3>
        <p className="text-gray-600 mb-4">
          Las agencias están agregando destinos increíbles. ¡Vuelve pronto para descubrirlos!
        </p>
        <Link to="/agency-signup" className="btn btn-primary">
          ¿Eres una agencia? Agrega tus destinos
        </Link>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {destinations.map((destination) => (
        <Link
          key={destination.id}
          to={`/tours?destination=${encodeURIComponent(destination.name)}`}
          className="group relative overflow-hidden rounded-lg aspect-[3/4] animate-fade-in"
        >
          <img
            src={destination.main_image_url || destination.sample_image}
            alt={destination.name}
            loading="lazy"
            className="absolute inset-0 w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-gray-900 to-transparent opacity-70"></div>
          <div className="absolute bottom-0 left-0 p-4 w-full">
            <div className="flex items-center text-white mb-1">
              <MapPin className="h-4 w-4 mr-1" />
              <span className="text-xs">
                {destination.tour_count} {destination.tour_count === 1 ? 'tour' : 'tours'}
              </span>
            </div>
            <h3 className="text-white text-xl font-bold">{destination.name}</h3>
          </div>
        </Link>
      ))}
    </div>
  );
};

export default FeaturedDestinations;