import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { getTourBySlug, resolveTourSlug, supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { BookingFlowProvider, useBookingFlow } from '../../context/BookingFlowContext';
import type { Tour } from '../../types';
import StepIndicator from '../../components/booking-flow/StepIndicator';
import RedirectBanner from '../../components/booking-flow/RedirectBanner';
import BookingFlowStep1 from './BookingFlowStep1';
import BookingFlowStep2 from './BookingFlowStep2';
import BookingFlowStep3 from './BookingFlowStep3';
import BookingFlowStep4 from './BookingFlowStep4';

const FlowContent: React.FC = () => {
  const { flow, clearRedirectMessage, goToStep } = useBookingFlow();
  const navigate = useNavigate();
  const location = useLocation();

  const stepFromUrl = (() => {
    const match = location.pathname.match(/\/paso-(\d)$/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n >= 1 && n <= 4) return n as 1 | 2 | 3 | 4;
    }
    return 1;
  })();

  useEffect(() => {
    if (flow.step !== stepFromUrl) {
      goToStep(stepFromUrl);
    }
  }, [stepFromUrl, flow.step, goToStep]);

  const renderStep = () => {
    switch (flow.step) {
      case 1:
        return <BookingFlowStep1 />;
      case 2:
        return <BookingFlowStep2 />;
      case 3:
        return <BookingFlowStep3 />;
      case 4:
        return <BookingFlowStep4 />;
      default:
        return <BookingFlowStep1 />;
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Volver
      </button>

      <StepIndicator currentStep={flow.step} />

      <RedirectBanner message={flow.pendingRedirectMessage} onDismiss={clearRedirectMessage} />

      {renderStep()}
    </div>
  );
};

const BookingFlowLayout: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { user, isTraveler, isLoading: authLoading } = useAuth();
  const [tour, setTour] = useState<Tour | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [resolvedSlug, setResolvedSlug] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;

    if (!user) {
      navigate('/login', { replace: true });
      return;
    }

    if (!isTraveler) {
      navigate('/', { replace: true });
      return;
    }

    if (!slug) {
      setError('Tour no encontrado.');
      setIsLoading(false);
      return;
    }

    const loadTour = async () => {
      setIsLoading(true);
      setError('');

      try {
        const { data, error: tourError } = await getTourBySlug(slug);

        if ((!data || tourError) && !tourError) {
          const newSlug = await resolveTourSlug(slug);
          if (newSlug && newSlug !== slug) {
            navigate(`/reservar/${newSlug}/paso-1`, { replace: true });
            setResolvedSlug(newSlug);
            return;
          }
        }

        if (tourError || !data) {
          setError('No se pudo encontrar este tour. Puede que haya sido removido.');
          setIsLoading(false);
          return;
        }

        const tourData = data as Tour;
        if (!tourData.agencies?.is_active) {
          setError('Este tour no esta disponible para reservas en este momento.');
          setIsLoading(false);
          return;
        }

        setTour(tourData);
        setResolvedSlug(slug);
      } catch (err: any) {
        setError('Error al cargar la informacion del tour.');
      } finally {
        setIsLoading(false);
      }
    };

    loadTour();
  }, [slug, user, isTraveler, authLoading, navigate]);

  if (authLoading || isLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <p className="text-lg text-gray-700 font-medium mb-2">{error}</p>
        <button
          onClick={() => navigate('/tours')}
          className="mt-4 px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
        >
          Ver todos los tours
        </button>
      </div>
    );
  }

  if (!tour || !resolvedSlug) {
    return null;
  }

  return (
    <BookingFlowProvider tourSlug={resolvedSlug} initialTour={tour} key={resolvedSlug}>
      <FlowContent />
    </BookingFlowProvider>
  );
};

export default BookingFlowLayout;
