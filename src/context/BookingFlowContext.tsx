import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import {
  BookingFlowState,
  INITIAL_FLOW_STATE,
  TravelerCounts,
  totalTravelerCount,
} from '../types/booking-flow';
import type { Tour } from '../types/index';

const STORAGE_KEY = 'booking_flow_state';
const SESSION_ID_KEY = 'booking_flow_session_id';

interface BookingFlowContextType {
  flow: BookingFlowState;
  sessionId: string;
  setTour: (tour: Tour) => void;
  updateFlow: (partial: Partial<BookingFlowState>) => void;
  goToStep: (step: 1 | 2 | 3 | 4) => void;
  setRedirectMessage: (message: string) => void;
  clearRedirectMessage: () => void;
  resetFlow: () => void;
  releaseHolds: () => Promise<void>;
}

const BookingFlowContext = createContext<BookingFlowContextType | null>(null);

export const useBookingFlow = () => {
  const ctx = useContext(BookingFlowContext);
  if (!ctx) throw new Error('useBookingFlow must be used within BookingFlowProvider');
  return ctx;
};

function getSessionId(): string {
  try {
    let id = sessionStorage.getItem(SESSION_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(SESSION_ID_KEY, id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

function loadFromStorage(tourSlug: string): BookingFlowState | null {
  try {
    const raw = sessionStorage.getItem(`${STORAGE_KEY}_${tourSlug}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BookingFlowState;
    if (parsed.tourSlug !== tourSlug) return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveToStorage(tourSlug: string, flow: BookingFlowState) {
  try {
    sessionStorage.setItem(`${STORAGE_KEY}_${tourSlug}`, JSON.stringify(flow));
  } catch {
    // sessionStorage may be full or unavailable — non-critical
  }
}

function clearStorage(tourSlug: string) {
  try {
    sessionStorage.removeItem(`${STORAGE_KEY}_${tourSlug}`);
  } catch {
    // ignore
  }
}

export const BookingFlowProvider: React.FC<{
  tourSlug: string;
  initialTour?: Tour | null;
  children: React.ReactNode;
}> = ({
  tourSlug,
  initialTour,
  children,
}) => {
  const [flow, setFlow] = useState<BookingFlowState>(() => {
    const stored = loadFromStorage(tourSlug);
    if (stored) return stored;
    return {
      ...INITIAL_FLOW_STATE,
      tourSlug,
      tourId: initialTour?.id ?? '',
      tour: initialTour ?? null,
    };
  });

  const sessionIdRef = useRef<string>(getSessionId());
  const tourSlugRef = useRef<string>(tourSlug);

  useEffect(() => {
    saveToStorage(tourSlug, flow);
  }, [flow, tourSlug]);

  const setTour = useCallback((tour: Tour) => {
    setFlow((prev) => ({
      ...prev,
      tourId: tour.id,
      tourSlug: tour.slug || tourSlug,
      tour,
    }));
  }, [tourSlug]);

  const updateFlow = useCallback((partial: Partial<BookingFlowState>) => {
    setFlow((prev) => ({ ...prev, ...partial }));
  }, []);

  const goToStep = useCallback((step: 1 | 2 | 3 | 4) => {
    setFlow((prev) => ({ ...prev, step }));
  }, []);

  const setRedirectMessage = useCallback((message: string) => {
    setFlow((prev) => ({ ...prev, pendingRedirectMessage: message }));
  }, []);

  const clearRedirectMessage = useCallback(() => {
    setFlow((prev) => ({ ...prev, pendingRedirectMessage: null }));
  }, []);

  const resetFlow = useCallback(() => {
    clearStorage(tourSlugRef.current);
    setFlow({ ...INITIAL_FLOW_STATE, tourSlug: tourSlugRef.current });
  }, []);

  const releaseHolds = useCallback(async () => {
    try {
      await supabase.rpc('release_seat_holds', {
        p_session_id: sessionIdRef.current,
      });
    } catch {
      // best-effort
    }
  }, []);

  // Release holds when the provider unmounts (user leaves the flow)
  useEffect(() => {
    return () => {
      try {
        supabase.rpc('release_seat_holds', {
          p_session_id: sessionIdRef.current,
        });
      } catch {
        // best-effort
      }
    };
  }, []);

  // Detect traveler count or slot changes that affect holds
  const prevTravelerCountRef = useRef<number>(totalTravelerCount(flow.travelerCounts));
  const prevSlotIdRef = useRef<string | null>(flow.selectedSlot?.id || null);

  useEffect(() => {
    const currentCount = totalTravelerCount(flow.travelerCounts);
    const currentSlotId = flow.selectedSlot?.id || null;

    if (prevSlotIdRef.current !== null && currentSlotId !== prevSlotIdRef.current) {
      setFlow((prev) => ({
        ...prev,
        selectedSeats: [],
        seatsHeld: false,
        holdExpiresAt: null,
        pendingRedirectMessage:
          'Cambiaste la fecha de tu tour. Los asientos que tenias apartados ya no aplican — selecciona asientos para la nueva fecha.',
      }));
      supabase.rpc('release_seat_holds', {
        p_session_id: sessionIdRef.current,
        p_slot_id: prevSlotIdRef.current,
      });
    }

    if (currentCount < prevTravelerCountRef.current && flow.selectedSeats.length > currentCount) {
      const excessSeats = flow.selectedSeats.slice(currentCount);
      const keptSeats = flow.selectedSeats.slice(0, currentCount);
      setFlow((prev) => ({
        ...prev,
        selectedSeats: keptSeats,
        pendingRedirectMessage: `Liberamos ${excessSeats.length} ${excessSeats.length === 1 ? 'asiento que ya no necesitas' : 'asientos que ya no necesitas'}. Tu reserva ahora es para ${currentCount} ${currentCount === 1 ? 'viajero' : 'viajeros'}.`,
      }));
      if (excessSeats.length > 0) {
        supabase.rpc('release_seat_holds', {
          p_session_id: sessionIdRef.current,
          p_seat_numbers: excessSeats,
        });
      }
    }

    if (currentCount > prevTravelerCountRef.current && flow.seatsHeld && flow.step >= 3) {
      setFlow((prev) => ({
        ...prev,
        pendingRedirectMessage: `Agregaste ${currentCount - prevTravelerCountRef.current} ${currentCount - prevTravelerCountRef.current === 1 ? 'viajero a tu reserva' : 'viajeros a tu reserva'}. Selecciona ${currentCount - prevTravelerCountRef.current === 1 ? 'su asiento' : 'sus asientos'} antes de continuar al pago.`,
        step: 3,
      }));
    }

    prevTravelerCountRef.current = currentCount;
    prevSlotIdRef.current = currentSlotId;
  }, [flow.travelerCounts, flow.selectedSlot, flow.selectedSeats, flow.seatsHeld, flow.step]);

  return (
    <BookingFlowContext.Provider
      value={{
        flow,
        sessionId: sessionIdRef.current,
        setTour,
        updateFlow,
        goToStep,
        setRedirectMessage,
        clearRedirectMessage,
        resetFlow,
        releaseHolds,
      }}
    >
      {children}
    </BookingFlowContext.Provider>
  );
};

export { useBookingFlow }