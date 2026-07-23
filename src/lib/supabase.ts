import { createClient } from '@supabase/supabase-js';
import { format, parse } from 'date-fns';
import { Tour, Booking, Destination, DestinationImage, ImageUploadData } from '../types';
import { formatCurrency } from '../utils/formatCurrency';

// Initialize Supabase client
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storage: window.localStorage,
  }
});

// User roles enum
export enum UserRole {
  ADMIN = 'admin',
  AGENCY = 'agency',
  TRAVELER = 'traveler',
  ACCOUNTANT = 'accountant',
  ACCOUNT_EXECUTIVE = 'account_executive',
}

// Date formatting helpers
export const formatDateForDB = (date: Date): string => {
  return format(date, 'yyyy-MM-dd');
};

export const parseDateFromDB = (dateString: string | null | undefined): Date => {
  if (!dateString) return new Date();
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date;
};

// Auth functions
export const signUp = async (
  email: string,
  password: string,
  role: UserRole,
  profileData: Record<string, any> = {}
) => {
  try {
    console.log('🔐 Registrando usuario con email:', email, 'y rol:', role);

    // Check if user already exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('id, email')
      .eq('email', email)
      .maybeSingle();

    let isExistingUser = false;

    if (existingUser) {
      console.log('⚠️ Usuario ya existe en la tabla users:', existingUser);
      isExistingUser = true;

      // Sign in instead
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) throw error;

      // Update user metadata with role
      await supabase.auth.updateUser({
        data: { role }
      });

      return { data, error: null, profileData: existingUser, isExistingUser };
    }

    // Check if CURP already exists for this role using security-definer RPC (works for anon)
    if (profileData.curp) {
      const { data: curpAvailable } = await supabase
        .rpc('check_curp_available', { p_curp: profileData.curp.toUpperCase(), p_role: role });

      if (curpAvailable === false) {
        console.log('⚠️ CURP ya existe en la base de datos para este rol');
        throw new Error('CURP_DUPLICADO');
      }
    }

    // Check if passport number already exists using security-definer RPC (works for anon)
    if (role === UserRole.TRAVELER && profileData.passport_number) {
      const { data: passportAvailable } = await supabase
        .rpc('check_passport_available', { p_passport: profileData.passport_number.toUpperCase() });

      if (passportAvailable === false) {
        console.log('⚠️ Número de pasaporte ya existe en la base de datos');
        throw new Error('PASAPORTE_DUPLICADO');
      }
    }

    // Create new user
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { role }
      }
    });

    if (error) throw error;

    if (!data.user) {
      throw new Error('No se pudo crear el usuario');
    }

    // Normalize CURP and passport number to uppercase if provided
    if (profileData.curp) {
      profileData.curp = profileData.curp.toUpperCase();
    }
    if (profileData.passport_number) {
      profileData.passport_number = profileData.passport_number.toUpperCase();
    }

    // Create user profile
    const { data: profile, error: profileError } = await supabase
      .from('users')
      .insert({
        id: data.user.id,
        email: email,
        role: role,
        ...profileData
      })
      .select()
      .single();

    if (profileError) {
      console.error('❌ Error creando perfil:', profileError);

      // The auth user was created but profile insert failed — clean up the orphaned auth user
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/delete-incomplete-signup`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${session.access_token}`,
              },
            }
          );
          await supabase.auth.signOut();
        }
      } catch (cleanupErr) {
        console.error('Error limpiando usuario auth huérfano:', cleanupErr);
      }

      // Check if it's a unique constraint violation on CURP (global or per-role index)
      if (profileError.code === '23505' && (profileError.message.includes('curp') || profileError.message.includes('users_curp_role_unique'))) {
        throw new Error('CURP_DUPLICADO');
      }

      // Check if it's a unique constraint violation on passport number
      if (profileError.code === '23505' && profileError.message.includes('passport_number')) {
        throw new Error('PASAPORTE_DUPLICADO');
      }

      throw profileError;
    }

    return { data, error: null, profileData: profile, isExistingUser };
  } catch (error: any) {
    console.error('❌ Error en signUp:', error);
    return { data: null, error, profileData: null, isExistingUser: false };
  }
};

export const signIn = async (email: string, password: string) => {
  try {
    console.log('🔐 Iniciando sesión con email:', email);

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;

    // Verificar si el usuario está activo
    if (data.user) {
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('is_active')
        .eq('id', data.user.id)
        .maybeSingle();

      if (userError) {
        console.error('❌ Error verificando estado del usuario:', userError);
      } else if (userData && userData.is_active === false) {
        // Usuario bloqueado, cerrar sesión inmediatamente
        await supabase.auth.signOut();
        throw new Error('USUARIO_BLOQUEADO');
      }
    }

    return { data, error: null };
  } catch (error: any) {
    console.error('❌ Error en signIn:', error);
    return { data: null, error };
  }
};

export const signOut = async () => {
  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    return { error: null };
  } catch (error: any) {
    console.error('❌ Error en signOut:', error);
    return { error };
  }
};

export const getCurrentUser = async () => {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return null;
    
    const { data: { user } } = await supabase.auth.getUser();
    return user;
  } catch (error) {
    console.error('❌ Error en getCurrentUser:', error);
    return null;
  }
};

// Agency functions
export const createAgencyProfile = async (
  userId: string,
  name: string,
  contactEmail: string,
  contactPhone?: string
) => {
  try {
    const { data, error } = await supabase
      .from('agencies')
      .insert({
        user_id: userId,
        name,
        contact_email: contactEmail,
        contact_phone: contactPhone,
        is_active: true
      })
      .select()
      .single();
    
    return { data, error };
  } catch (error: any) {
    console.error('❌ Error en createAgencyProfile:', error);
    return { data: null, error };
  }
};

export const updateAgencyStatus = async (agencyId: string, isActive: boolean) => {
  try {
    // Primero obtener el user_id de la agencia
    const { data: agencyData, error: agencyError } = await supabase
      .from('agencies')
      .select('user_id')
      .eq('id', agencyId)
      .single();

    if (agencyError) throw agencyError;

    // Actualizar is_active en la tabla agencies
    const { error: updateAgencyError } = await supabase
      .from('agencies')
      .update({ is_active: isActive })
      .eq('id', agencyId);

    if (updateAgencyError) throw updateAgencyError;

    // Actualizar is_active en la tabla users (esto controla el login)
    const { error: updateUserError } = await supabase
      .from('users')
      .update({ is_active: isActive })
      .eq('id', agencyData.user_id);

    if (updateUserError) throw updateUserError;

    // Retornar los datos actualizados
    const { data, error } = await supabase
      .from('agencies')
      .select()
      .eq('id', agencyId)
      .single();

    return { data, error };
  } catch (error: any) {
    console.error('❌ Error en updateAgencyStatus:', error);
    return { data: null, error };
  }
};

export const getAllAgencies = async () => {
  try {
    // OPTIMIZED: Select only needed columns for admin listings
    const { data, error } = await supabase
      .from('agencies')
      .select(`
        id,
        name,
        is_active,
        created_at,
        contact_phone,
        contact_email,
        website,
        rating,
        commission_rate,
        users(first_name, last_name, email)
      `)
      .order('created_at', { ascending: false });

    return { data, error };
  } catch (error: any) {
    console.error('❌ Error en getAllAgencies:', error);
    return { data: null, error };
  }
};

// Tour functions
export const getTours = async (filters: any = {}) => {
  try {
    console.log('🔍 Obteniendo tours con filtros:', filters);

    // Variables para acumular IDs de tours filtrados
    let tourIdsByDestination: string[] | null = null;
    let tourIdsByDeparturePoint: string[] | null = null;

    // Si hay filtro de destino, buscar tours por la tabla de relaciones
    if (filters.destination) {
      const { data: matchingDestinations } = await supabase
        .from('destinations')
        .select('id')
        .ilike('name', `%${filters.destination}%`);

      if (matchingDestinations && matchingDestinations.length > 0) {
        const destinationIds = matchingDestinations.map(d => d.id);

        const { data: tourDestinations } = await supabase
          .from('tour_destinations')
          .select('tour_id')
          .in('destination_id', destinationIds);

        if (tourDestinations && tourDestinations.length > 0) {
          tourIdsByDestination = tourDestinations.map(td => td.tour_id);
        } else {
          tourIdsByDestination = [];
        }
      } else {
        tourIdsByDestination = [];
      }
    }

    // Si hay filtro de punto de partida, buscar tours por la tabla de relaciones
    if (filters.departurePoint) {
      console.log('🔍 Buscando punto de partida:', filters.departurePoint);

      const { data: matchingDeparturePoints, error: dpError } = await supabase
        .from('departure_points')
        .select('id, name')
        .ilike('name', `%${filters.departurePoint}%`);

      console.log('📍 Puntos de partida encontrados:', matchingDeparturePoints);
      if (dpError) console.error('❌ Error buscando departure points:', dpError);

      if (matchingDeparturePoints && matchingDeparturePoints.length > 0) {
        const departurePointIds = matchingDeparturePoints.map(dp => dp.id);

        const { data: tourDeparturePoints, error: tdpError } = await supabase
          .from('tour_departure_points')
          .select('tour_id')
          .in('departure_point_id', departurePointIds);

        console.log('🎯 Tours con estos puntos de partida:', tourDeparturePoints);
        if (tdpError) console.error('❌ Error buscando tour_departure_points:', tdpError);

        if (tourDeparturePoints && tourDeparturePoints.length > 0) {
          tourIdsByDeparturePoint = tourDeparturePoints.map(tdp => tdp.tour_id);
        } else {
          tourIdsByDeparturePoint = [];
        }
      } else {
        tourIdsByDeparturePoint = [];
      }
    }

    // Combinar los IDs de tours filtrados
    let finalTourIds: string[] | null = null;

    console.log('📊 tourIdsByDestination:', tourIdsByDestination);
    console.log('📊 tourIdsByDeparturePoint:', tourIdsByDeparturePoint);

    if (tourIdsByDestination !== null && tourIdsByDeparturePoint !== null) {
      // Intersección: tours que cumplen ambos filtros
      finalTourIds = tourIdsByDestination.filter(id => tourIdsByDeparturePoint!.includes(id));
      console.log('🔀 Intersección de ambos filtros:', finalTourIds);
    } else if (tourIdsByDestination !== null) {
      finalTourIds = tourIdsByDestination;
      console.log('📍 Solo filtro de destino:', finalTourIds);
    } else if (tourIdsByDeparturePoint !== null) {
      finalTourIds = tourIdsByDeparturePoint;
      console.log('🚩 Solo filtro de punto de partida:', finalTourIds);
    }

    console.log('✅ IDs finales a buscar:', finalTourIds);

    // Si tenemos IDs filtrados, aplicar filtro .in()
    if (finalTourIds !== null) {
      if (finalTourIds.length === 0) {
        console.log('❌ No hay tours que cumplan los criterios');
        // No hay tours que cumplan los criterios
        return { data: [], error: null };
      }

      // OPTIMIZED: Select only needed columns for listings
      let query = supabase
        .from('tours')
        .select(`
          id,
          slug,
          name,
          image_url,
          destination,
          start_date,
          end_date,
          price,
          max_travelers,
          is_featured,
          agency_id,
          pet_friendly,
          category,
          agencies(id, name, rating, is_active)
        `)
        .in('id', finalTourIds);

      if (filters.includeExpired !== true) {
        const today = formatDateForDB(new Date());
        query = query.or(`end_date.gte.${today},end_date.is.null`);
      }

      if (filters.tourName) {
        query = query.ilike('title', `%${filters.tourName}%`);
      }

      if (filters.category) {
        query = query.contains('category', [filters.category]);
      }

      if (filters.startDate && filters.endDate) {
        query = query.gte('start_date', filters.startDate).lte('start_date', filters.endDate);
      } else if (filters.startDate) {
        query = query.gte('start_date', filters.startDate);
      } else if (filters.endDate) {
        query = query.lte('start_date', filters.endDate);
      }

      if (filters.agency) {
        query = query.eq('agency_id', filters.agency);
      }

      if (filters.minPrice) {
        query = query.gte('price', parseFloat(filters.minPrice));
      }

      if (filters.maxPrice) {
        query = query.lte('price', parseFloat(filters.maxPrice));
      }

      if (filters.petFriendly === 'true') {
        query = query.eq('pet_friendly', true);
      } else if (filters.petFriendly === 'false') {
        query = query.eq('pet_friendly', false);
      }

      query = query.order('is_featured', { ascending: false }).order('created_at', { ascending: false });

      if (filters.limit) {
        const offset = filters.offset ?? 0;
        query = (query as any).range(offset, offset + filters.limit - 1);
      }

      const { data, error } = await query;

      if (data && filters.includeInactiveAgencies !== true) {
        const filteredData = data.filter((tour: any) => tour.agencies?.is_active !== false);
        return { data: filteredData, error, count: filteredData.length };
      }

      return { data, error, count: data?.length ?? 0 };
    }

    const selectColumns = `
      id,
      slug,
      name,
      image_url,
      destination,
      start_date,
      end_date,
      price,
      max_travelers,
      is_featured,
      agency_id,
      pet_friendly,
      category,
      tour_type,
      activity_type,
      agencies(id, name, rating, is_active)
    `;

    let query = supabase
      .from('tours')
      .select(selectColumns, filters.limit ? { count: 'exact' } : undefined);

    if (filters.includeExpired !== true) {
      const today = formatDateForDB(new Date());
      query = query.or(`end_date.gte.${today},end_date.is.null`);
    }

    if (filters.tourName) {
      query = query.ilike('name', `%${filters.tourName}%`);
    }

    if (filters.destination) {
      query = query.ilike('destination', `%${filters.destination}%`);
    }

    if (filters.category) {
      query = query.contains('category', [filters.category]);
    }

    if (filters.startDate && filters.endDate) {
      query = query.gte('start_date', filters.startDate).lte('start_date', filters.endDate);
    } else if (filters.startDate) {
      query = query.gte('start_date', filters.startDate);
    } else if (filters.endDate) {
      query = query.lte('start_date', filters.endDate);
    }

    if (filters.agency) {
      query = query.eq('agency_id', filters.agency);
    }

    if (filters.minPrice) {
      query = query.gte('price', parseFloat(filters.minPrice));
    }

    if (filters.maxPrice) {
      query = query.lte('price', parseFloat(filters.maxPrice));
    }

    if (filters.petFriendly === 'true') {
      query = query.eq('pet_friendly', true);
    } else if (filters.petFriendly === 'false') {
      query = query.eq('pet_friendly', false);
    }

    if (filters.tourType) {
      query = query.eq('tour_type', filters.tourType);
    }

    if (filters.activityType) {
      query = query.eq('activity_type', filters.activityType);
    }

    if (filters.includeInactiveAgencies !== true) {
      query = query.eq('agencies.is_active', true);
    }

    query = query.order('is_featured', { ascending: false }).order('created_at', { ascending: false });

    if (filters.limit) {
      const offset = filters.offset ?? 0;
      query = (query as any).range(offset, offset + filters.limit - 1);
    }

    const { data, count, error } = await query;

    return { data: data ?? [], error, count: count ?? data?.length ?? 0 };
  } catch (error: any) {
    console.error('❌ Error en getTours:', error);
    return { data: null, error, count: 0 };
  }
};

export const getPopularTours = async (limit = 20) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const { data, error } = await supabase
      .from('tours')
      .select(`
        id,
        slug,
        name,
        image_url,
        destination,
        start_date,
        end_date,
        price,
        max_travelers,
        is_featured,
        agency_id,
        pet_friendly,
        category,
        tour_type,
        agencies(id, name, rating, is_active),
        bookings(id, status)
      `)
      .or(`end_date.gte.${today},end_date.is.null`)
      .limit(200);

    if (error) return { data: [], error };

    // 70% confirmed bookings + 30% agency rating, max 3 per agency
    const normalized = (data ?? [])
      .filter((t: any) => t.agencies?.is_active !== false)
      .map((t: any) => {
        const confirmedBookings = Array.isArray(t.bookings)
          ? t.bookings.filter((b: any) => b.status !== 'cancelled').length
          : 0;
        const agencyRating = t.agencies?.rating ?? 0;
        return { ...t, booking_count: confirmedBookings, _score: confirmedBookings * 0.7 + agencyRating * 0.3 };
      })
      .sort((a: any, b: any) => b._score - a._score);

    // Cap max 3 per agency
    const agencyCounts: Record<string, number> = {};
    const capped: any[] = [];
    for (const t of normalized) {
      const aid = t.agency_id;
      agencyCounts[aid] = (agencyCounts[aid] || 0) + 1;
      if (agencyCounts[aid] <= 3) capped.push(t);
      if (capped.length >= limit) break;
    }

    return { data: capped, error: null };
  } catch (error: any) {
    return { data: [], error };
  }
};

// Returns tours with active paid featured slots (expires_at > NOW())
export const getActiveFeaturedTours = async () => {
  try {
    const { data, error } = await supabase
      .from('featured_tour_slots')
      .select(`
        id,
        tour_id,
        agency_id,
        expires_at,
        tours(
          id,
          slug,
          name,
          image_url,
          destination,
          start_date,
          end_date,
          price,
          max_travelers,
          is_featured,
          agency_id,
          pet_friendly,
          category,
          tour_type,
          preventa_activa,
          preventa_inicio,
          preventa_fin,
          preventa_precio_especial,
          preventa_tipo_descuento,
          preventa_descuento_valor,
          agencies(id, name, rating, is_active)
        )
      `)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString())
      .limit(50);

    if (error) return { data: [], slotMap: {}, error };

    const slotMap: Record<string, string> = {};
    const tours: any[] = [];

    for (const slot of data ?? []) {
      const tour = (slot as any).tours;
      if (!tour || tour.agencies?.is_active === false) continue;
      slotMap[tour.id] = slot.id;
      tours.push({ ...tour, _featured_slot_id: slot.id });
    }

    return { data: tours, slotMap, error: null };
  } catch (error: any) {
    return { data: [], slotMap: {}, error };
  }
};

// Returns newest tours chronologically, max 3 per agency
export const getNewTours = async (limit = 20) => {
  try {
    const { data, error } = await supabase
      .from('tours')
      .select(`
        id,
        slug,
        name,
        image_url,
        destination,
        start_date,
        end_date,
        price,
        max_travelers,
        is_featured,
        agency_id,
        pet_friendly,
        category,
        tour_type,
        created_at,
        preventa_activa,
        preventa_inicio,
        preventa_fin,
        preventa_precio_especial,
        preventa_tipo_descuento,
        preventa_descuento_valor,
        agencies(id, name, rating, is_active)
      `)
      .or(`end_date.gte.${formatDateForDB(new Date())},end_date.is.null`)
      .order('created_at', { ascending: false })
      .limit(200);

    if (error) return { data: [], error };

    const agencyCounts: Record<string, number> = {};
    const capped: any[] = [];
    for (const t of data ?? []) {
      if ((t as any).agencies?.is_active === false) continue;
      const aid = (t as any).agency_id;
      agencyCounts[aid] = (agencyCounts[aid] || 0) + 1;
      if (agencyCounts[aid] <= 3) capped.push(t);
      if (capped.length >= limit) break;
    }

    return { data: capped, error: null };
  } catch (error: any) {
    return { data: [], error };
  }
};

export const getFeaturedPlans = async () => {
  try {
    const { data, error } = await supabase
      .from('featured_plans')
      .select('*')
      .eq('is_active', true)
      .order('display_order');
    return { data: data ?? [], error };
  } catch (error: any) {
    return { data: [], error };
  }
};

export const getAgencyFeaturedSlots = async (agencyId: string) => {
  try {
    const { data, error } = await supabase
      .from('featured_tour_slots')
      .select(`
        *,
        featured_plans(id, name, duration_days, price),
        featured_tour_stats(impressions, clicks, bookings_generated),
        tours(id, name, destination, image_url)
      `)
      .eq('agency_id', agencyId)
      .order('created_at', { ascending: false });
    const normalized = (data ?? []).map((slot: any) => ({
      ...slot,
      featured_tour_stats: Array.isArray(slot.featured_tour_stats)
        ? (slot.featured_tour_stats[0] ?? null)
        : slot.featured_tour_stats,
    }));
    return { data: normalized, error };
  } catch (error: any) {
    return { data: [], error };
  }
};

export const getAgencyFeaturedWaitlist = async (agencyId: string) => {
  try {
    const { data, error } = await supabase
      .from('featured_tour_waitlist')
      .select(`*, featured_plans(id, name, duration_days, price), tours(id, name, destination)`)
      .eq('agency_id', agencyId)
      .in('status', ['waiting', 'notified'])
      .order('created_at', { ascending: false });
    return { data: data ?? [], error };
  } catch (error: any) {
    return { data: [], error };
  }
};

// Track featured tour impression via DB function (called by IntersectionObserver)
export const trackFeaturedImpression = async (slotId: string) => {
  try {
    await supabase.rpc('increment_featured_stat', { p_slot_id: slotId, p_field: 'impressions' });
  } catch (_) { /* non-critical */ }
};

export const trackFeaturedClick = async (slotId: string) => {
  try {
    await supabase.rpc('increment_featured_stat', { p_slot_id: slotId, p_field: 'clicks' });
  } catch (_) { /* non-critical */ }
};

export const trackFeaturedBooking = async (slotId: string) => {
  try {
    await supabase.rpc('increment_featured_stat', { p_slot_id: slotId, p_field: 'bookings_generated' });
  } catch (_) { /* non-critical */ }
};

export const joinFeaturedWaitlist = async (tourId: string, planId: string, agencyId: string) => {
  try {
    const { data: existing } = await supabase
      .from('featured_tour_waitlist')
      .select('id')
      .eq('tour_id', tourId)
      .eq('agency_id', agencyId)
      .in('status', ['waiting', 'notified'])
      .maybeSingle();

    if (existing) return { error: new Error('Ya estás en la lista de espera para este tour') };

    const { data: last } = await supabase
      .from('featured_tour_waitlist')
      .select('position')
      .eq('tour_id', tourId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextPosition = ((last as any)?.position ?? 0) + 1;
    const { error } = await supabase
      .from('featured_tour_waitlist')
      .insert({ tour_id: tourId, agency_id: agencyId, plan_id: planId, position: nextPosition });

    return { error };
  } catch (error: any) {
    return { error };
  }
};

export const getTourById = async (id: string) => {
  try {
    const { data, error } = await supabase
      .from('tours')
      .select(`
        *,
        agencies(id, name, rating, logo, description, contact_email, is_active, commission_rate)
      `)
      .eq('id', id)
      .maybeSingle();

    return { data, error };
  } catch (error: any) {
    console.error('❌ Error en getTourById:', error);
    return { data: null, error };
  }
};

export const getTourBySlug = async (slug: string) => {
  try {
    const { data, error } = await supabase
      .from('tours')
      .select(`
        *,
        agencies(id, name, rating, logo, description, contact_email, is_active, commission_rate)
      `)
      .eq('slug', slug)
      .maybeSingle();

    return { data, error };
  } catch (error: any) {
    console.error('❌ Error en getTourBySlug:', error);
    return { data: null, error };
  }
};

export const resolveTourSlug = async (oldSlug: string): Promise<string | null> => {
  try {
    const { data, error } = await supabase
      .rpc('resolve_tour_slug', { p_old_slug: oldSlug });

    if (error) {
      console.error('❌ Error en resolveTourSlug:', error);
      return null;
    }

    if (data && data.length > 0 && data[0].current_slug) {
      return data[0].current_slug as string;
    }

    return null;
  } catch (error: any) {
    console.error('❌ Error en resolveTourSlug:', error);
    return null;
  }
};

export const checkSlugAvailable = async (slug: string, excludeTourId?: string): Promise<boolean> => {
  try {
    const { data, error } = await supabase
      .rpc('check_slug_available', {
        p_slug: slug,
        p_exclude_tour_id: excludeTourId || null,
      });

    if (error) {
      console.error('❌ Error en checkSlugAvailable:', error);
      return false;
    }

    return data as boolean;
  } catch (error: any) {
    console.error('❌ Error en checkSlugAvailable:', error);
    return false;
  }
};

export const updateTourSlug = async (
  tourId: string,
  newSlug: string,
  confirm: boolean
): Promise<{ success: boolean; slug: string | null; message: string }> => {
  try {
    const { data, error } = await supabase
      .rpc('update_tour_slug', {
        p_tour_id: tourId,
        p_new_slug: newSlug,
        p_confirm: confirm,
      });

    if (error) {
      console.error('❌ Error en updateTourSlug:', error);
      return { success: false, slug: null, message: error.message };
    }

    if (data && data.length > 0) {
      return {
        success: data[0].success,
        slug: data[0].slug,
        message: data[0].message,
      };
    }

    return { success: false, slug: null, message: 'Respuesta vacía del servidor' };
  } catch (error: any) {
    console.error('❌ Error en updateTourSlug:', error);
    return { success: false, slug: null, message: error.message };
  }
};

export const createTour = async (tourData: any, destinations: string[], userId: string) => {
  try {
    console.log('🏞️ Creando tour con datos:', tourData);
    
    // First get the agency ID for this user
    const { data: agencyData, error: agencyError } = await supabase
      .from('agencies')
      .select('id')
      .eq('user_id', userId)
      .single();
    
    if (agencyError) {
      throw new Error('No se encontró la agencia para este usuario');
    }
    
    // Create the tour
    const { data: tour, error: tourError } = await supabase
      .from('tours')
      .insert({
        ...tourData,
        agency_id: agencyData.id
      })
      .select()
      .single();
    
    if (tourError) {
      throw new Error(`Error al crear el tour: ${tourError.message}`);
    }
    
    // Add tour-destination relationships
    if (destinations.length > 0) {
      const tourDestinations = destinations.map(destination => ({
        tour_id: tour.id,
        destination_id: destination
      }));
      
      const { error: relationError } = await supabase
        .from('tour_destinations')
        .insert(tourDestinations);
      
      if (relationError) {
        console.error('❌ Error al asociar destinos:', relationError);
      }
    }
    
    return { data: tour, error: null };
  } catch (error: any) {
    console.error('❌ Error en createTour:', error);
    return { data: null, error };
  }
};

export const updateTour = async (tourId: string, tourData: any) => {
  try {
    const { data, error } = await supabase
      .from('tours')
      .update(tourData)
      .eq('id', tourId)
      .select()
      .single();
    
    return { data, error };
  } catch (error: any) {
    console.error('❌ Error en updateTour:', error);
    return { data: null, error };
  }
};

export const deleteTour = async (tourId: string) => {
  try {
    const { error } = await supabase
      .from('tours')
      .delete()
      .eq('id', tourId);
    
    return { error };
  } catch (error: any) {
    console.error('❌ Error en deleteTour:', error);
    return { error };
  }
};

// Booking functions
export const createBooking = async (bookingData: any) => {
  try {
    const { data, error } = await supabase
      .from('bookings')
      .insert(bookingData)
      .select()
      .single();

    if (error) {
      return { data: null, error };
    }

    // Nota: Los puntos NO se descuentan aquí. Solo se guarda points_used en la reserva.
    // Los puntos se descontarán del wallet en TravelersInfoPage cuando el usuario
    // confirme el pago después de ingresar la información de los viajeros.
    if (data && bookingData.points_used && bookingData.points_used > 0) {
      console.log(`📝 Reserva creada con ${bookingData.points_used} puntos marcados para uso (se descontarán al confirmar pago)`);
    }

    return { data, error: null };
  } catch (error: any) {
    console.error('❌ Error en createBooking:', error);
    return { data: null, error };
  }
};

export const getUserBookings = async (userId: string) => {
  try {
    const { data: bookings, error } = await supabase
      .from('bookings')
      .select(BOOKING_SELECT_FIELDS)
      .eq('user_id', userId)
      .neq('status', 'draft')
      .neq('status', 'cancelled')
      .neq('status', 'completed')
      .order('created_at', { ascending: false });

    if (error || !bookings) {
      return { data: bookings, error };
    }

    // OPTIMIZED: Get all payment transactions in ONE query instead of N queries
    const bookingIds = bookings.map(b => b.id);
    const { data: allTransactions } = await supabase
      .from('payment_transactions')
      .select('booking_id, payment_method_type, created_at')
      .in('booking_id', bookingIds);

    // Group transactions by booking_id and get the most recent
    const transactionsByBooking: Record<string, any> = {};
    (allTransactions || []).forEach((tx: any) => {
      if (!transactionsByBooking[tx.booking_id] ||
          new Date(tx.created_at) > new Date(transactionsByBooking[tx.booking_id].created_at)) {
        transactionsByBooking[tx.booking_id] = tx;
      }
    });

    // Map bookings with payment methods (no more N+1!)
    const bookingsWithPaymentMethod = bookings.map((booking) => {
      let paymentMethod = (booking as any).payment_method || null;

      // If no payment_method, use the most recent transaction
      if (!paymentMethod && transactionsByBooking[booking.id]) {
        paymentMethod = transactionsByBooking[booking.id].payment_method_type || null;
      }

      return {
        ...booking,
        payment_method: paymentMethod
      };
    });

    return { data: bookingsWithPaymentMethod, error: null };
  } catch (error: any) {
    console.error('❌ Error en getUserBookings:', error);
    return { data: null, error };
  }
};

const BOOKING_SELECT_FIELDS = `
  id, booking_code, user_id, tour_id, agency_id, booking_date, status, payment_status,
  payment_method, total_price, deposit_amount, user_payment, service_charge, travelers_count,
  approval_status, approval_notes, approved_at, is_no_show, no_show_marked_at,
  toursred_cash_used, points_used, points_earned, has_pending_reschedule, reschedule_response,
  reschedule_responded_at, has_pending_slot_reschedule, slot_reschedule_response,
  slot_reschedule_responded_at, selected_date, selected_time, slot_id, selected_seats,
  previous_selected_seats, needs_seat_reselection, discount_amount, discount_code_id,
  travel_insurance_included, travel_insurance_cost, insurance_days,
  has_payment_plan, payment_plan_total, payment_plan_paid, payment_plan_status,
  discount_codes:discount_code_id(code, discount_type, discount_value), created_at, updated_at,
  tours:tour_id(id, name, slug, destination, image_url, start_date, end_date, name_changes_not_allowed, vehicle_map_type),
  agencies:agency_id(id, name, contact_email)
`;

export const getUserPastBookings = async (userId: string) => {
  try {
    const { data: bookings, error } = await supabase
      .from('bookings')
      .select(BOOKING_SELECT_FIELDS)
      .eq('user_id', userId)
      .eq('status', 'completed')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error || !bookings) return { data: bookings, error };

    const bookingIds = bookings.map((b: any) => b.id);
    const { data: allTransactions } = await supabase
      .from('payment_transactions')
      .select('booking_id, payment_method_type, created_at')
      .in('booking_id', bookingIds);

    const transactionsByBooking: Record<string, any> = {};
    (allTransactions || []).forEach((tx: any) => {
      if (!transactionsByBooking[tx.booking_id] ||
          new Date(tx.created_at) > new Date(transactionsByBooking[tx.booking_id].created_at)) {
        transactionsByBooking[tx.booking_id] = tx;
      }
    });

    const result = bookings.map((booking: any) => ({
      ...booking,
      payment_method: booking.payment_method || transactionsByBooking[booking.id]?.payment_method_type || null,
    }));
    return { data: result, error: null };
  } catch (error: any) {
    return { data: null, error };
  }
};

export const getUserCancelledBookings = async (userId: string) => {
  try {
    const { data: bookings, error } = await supabase
      .from('bookings')
      .select(BOOKING_SELECT_FIELDS)
      .eq('user_id', userId)
      .eq('status', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error || !bookings) return { data: bookings, error };

    const bookingIds = bookings.map((b: any) => b.id);
    const { data: allTransactions } = await supabase
      .from('payment_transactions')
      .select('booking_id, payment_method_type, created_at')
      .in('booking_id', bookingIds);

    const transactionsByBooking: Record<string, any> = {};
    (allTransactions || []).forEach((tx: any) => {
      if (!transactionsByBooking[tx.booking_id] ||
          new Date(tx.created_at) > new Date(transactionsByBooking[tx.booking_id].created_at)) {
        transactionsByBooking[tx.booking_id] = tx;
      }
    });

    const result = bookings.map((booking: any) => ({
      ...booking,
      payment_method: booking.payment_method || transactionsByBooking[booking.id]?.payment_method_type || null,
    }));
    return { data: result, error: null };
  } catch (error: any) {
    return { data: null, error };
  }
};

export const getAgencyBookings = async (agencyId: string) => {
  try {
    const { data: bookings, error } = await supabase
      .from('bookings')
      .select(`
        *,
        tours:tour_id(id, name, slug, destination, image_url, start_date, end_date),
        users:user_id(id, first_name, last_name, email, profile_picture_url, phone_number)
      `)
      .eq('agency_id', agencyId)
      .neq('status', 'draft')
      .order('created_at', { ascending: false });

    if (error || !bookings) {
      return { data: bookings, error };
    }

    // OPTIMIZED: Get all payment transactions in ONE query instead of N queries
    const bookingIds = bookings.map(b => b.id);
    const { data: allTransactions } = await supabase
      .from('payment_transactions')
      .select('booking_id, payment_method_type, created_at')
      .in('booking_id', bookingIds);

    // Group transactions by booking_id and get the most recent
    const transactionsByBooking: Record<string, any> = {};
    (allTransactions || []).forEach((tx: any) => {
      if (!transactionsByBooking[tx.booking_id] ||
          new Date(tx.created_at) > new Date(transactionsByBooking[tx.booking_id].created_at)) {
        transactionsByBooking[tx.booking_id] = tx;
      }
    });

    // Map bookings with payment methods (no more N+1!)
    const bookingsWithPaymentMethod = bookings.map((booking) => {
      let paymentMethod = (booking as any).payment_method || null;

      // If no payment_method, use the most recent transaction
      if (!paymentMethod && transactionsByBooking[booking.id]) {
        paymentMethod = transactionsByBooking[booking.id].payment_method_type || null;
      }

      return {
        ...booking,
        payment_method: paymentMethod
      };
    });

    return { data: bookingsWithPaymentMethod, error: null };
  } catch (error: any) {
    console.error('❌ Error en getAgencyBookings:', error);
    return { data: null, error };
  }
};

export const getTourBookingReport = async (tourId: string, agencyId: string) => {
  try {
    const { data: tour, error: tourError } = await supabase
      .from('tours')
      .select('id, name, destination, start_date, end_date')
      .eq('id', tourId)
      .eq('agency_id', agencyId)
      .maybeSingle();

    if (tourError || !tour) {
      return { data: null, error: tourError || new Error('Tour no encontrado') };
    }

    const { data: bookings, error: bookingsError } = await supabase
      .from('bookings')
      .select(`
        id,
        booking_code,
        user_id,
        deposit_amount,
        total_price,
        user_payment,
        payment_method,
        booking_date,
        created_at,
        status,
        count_adultos,
        count_ninos,
        count_infantes,
        count_adultos_mayores,
        count_mascotas,
        toursred_cash_used,
        users:user_id(id, first_name, last_name, email, phone_number)
      `)
      .eq('tour_id', tourId)
      .in('status', ['confirmed', 'completed'])
      .order('created_at', { ascending: true });

    if (bookingsError) {
      return { data: null, error: bookingsError };
    }

    const bookingsWithTravelers = await Promise.all(
      (bookings || []).map(async (booking) => {
        const { data: travelersRaw } = await supabase
          .from('booking_travelers')
          .select('*')
          .eq('booking_id', booking.id)
          .order('created_at', { ascending: true });

        // Build travelers list from count_* fields (source of truth) using booking_travelers data when available
        const categoryMap: { key: string; label: string; count: number }[] = [
          { key: 'adulto', label: 'adulto', count: booking.count_adultos || 0 },
          { key: 'nino', label: 'nino', count: booking.count_ninos || 0 },
          { key: 'infante', label: 'infante', count: booking.count_infantes || 0 },
          { key: 'adulto_mayor', label: 'adulto_mayor', count: booking.count_adultos_mayores || 0 },
          { key: 'mascota', label: 'mascota', count: booking.count_mascotas || 0 },
        ];

        const travelersFromCounts: any[] = [];
        for (const cat of categoryMap) {
          if (cat.count <= 0) continue;
          const registered = (travelersRaw || []).filter(
            (t: any) => t.categoria_viajero === cat.key
          );
          for (let i = 0; i < cat.count; i++) {
            if (registered[i]) {
              travelersFromCounts.push(registered[i]);
            } else {
              // Viajero sin datos de acompañante registrado (ej. 2x1)
              const firstName = (booking as any).users?.first_name || '';
              const lastName = (booking as any).users?.last_name || '';
              travelersFromCounts.push({
                id: `${booking.id}-${cat.key}-${i}`,
                booking_id: booking.id,
                categoria_viajero: cat.key,
                nombre: `${firstName} ${lastName}`.trim(),
                precio_aplicado: 0,
              });
            }
          }
        }

        let paymentMethod = booking.payment_method || null;
        if (!paymentMethod) {
          const { data: transaction } = await supabase
            .from('payment_transactions')
            .select('payment_method_type')
            .eq('booking_id', booking.id)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          paymentMethod = transaction?.payment_method_type || null;
        }

        return {
          ...booking,
          travelers: travelersFromCounts,
          payment_method: paymentMethod
        };
      })
    );

    const totalsByCategory = {
      adultos: bookingsWithTravelers.reduce((sum, b) => sum + (b.count_adultos || 0), 0),
      ninos: bookingsWithTravelers.reduce((sum, b) => sum + (b.count_ninos || 0), 0),
      infantes: bookingsWithTravelers.reduce((sum, b) => sum + (b.count_infantes || 0), 0),
      adultos_mayores: bookingsWithTravelers.reduce((sum, b) => sum + (b.count_adultos_mayores || 0), 0),
      mascotas: bookingsWithTravelers.reduce((sum, b) => sum + (b.count_mascotas || 0), 0)
    };

    const totalTravelers =
      totalsByCategory.adultos +
      totalsByCategory.ninos +
      totalsByCategory.infantes +
      totalsByCategory.adultos_mayores +
      totalsByCategory.mascotas;

    const totalDeposit = bookingsWithTravelers.reduce((sum, b) => sum + Number(b.deposit_amount || 0), 0);
    const totalRemaining = bookingsWithTravelers.reduce((sum, b) => {
      if ((b as any).has_payment_plan) {
        return sum + (Number((b as any).payment_plan_total || 0) - Number((b as any).payment_plan_paid || 0));
      }
      return sum + (Number(b.total_price || 0) - Number(b.deposit_amount || 0));
    }, 0);
    const totalRevenue = bookingsWithTravelers.reduce((sum, b) => sum + Number(b.total_price || 0), 0);

    return {
      data: {
        tour,
        bookings: bookingsWithTravelers,
        summary: {
          totalBookings: bookingsWithTravelers.length,
          totalTravelers,
          totalsByCategory,
          totalDeposit,
          totalRemaining,
          totalRevenue
        }
      },
      error: null
    };
  } catch (error: any) {
    console.error('❌ Error en getTourBookingReport:', error);
    return { data: null, error };
  }
};

// Review functions
export const getTourReviews = async (tourId: string) => {
  try {
    const { data, error } = await supabase
      .from('reviews')
      .select(`
        *,
        users(first_name, last_name)
      `)
      .eq('tour_id', tourId)
      .eq('is_visible', true)
      .order('created_at', { ascending: false });
    
    return { data, error };
  } catch (error: any) {
    console.error('❌ Error en getTourReviews:', error);
    return { data: null, error };
  }
};

// Destination functions
export const getAllDestinations = async () => {
  try {
    const { data, error } = await supabase
      .from('destinations')
      .select(`
        *,
        destination_images(id, image_url, caption, is_featured),
        tour_destinations(tour_id)
      `)
      .order('name', { ascending: true });
    
    return { data, error };
  } catch (error: any) {
    console.error('❌ Error en getAllDestinations:', error);
    return { data: null, error };
  }
};

export const searchDestinations = async (query: string) => {
  try {
    const { data, error } = await supabase
      .from('destinations')
      .select('id, name')
      .ilike('name', `%${query}%`)
      .order('name', { ascending: true })
      .limit(5);
    
    return { data, error };
  } catch (error: any) {
    console.error('❌ Error en searchDestinations:', error);
    return { data: null, error };
  }
};

export const createDestination = async (destinationData: any) => {
  try {
    const { data, error } = await supabase
      .from('destinations')
      .insert(destinationData)
      .select()
      .maybeSingle();
    
    if (error) {
      return { data: null, error };
    }
    
    if (!data) {
      return { data: null, error: new Error('No se pudo crear el destino o recuperar el registro creado.') };
    }
    
    return { data, error };
  } catch (error: any) {
    console.error('❌ Error en createDestination:', error);
    return { data: null, error };
  }
};

export const updateDestination = async (destinationId: string, destinationData: any) => {
  try {
    const { data, error } = await supabase
      .from('destinations')
      .update(destinationData)
      .eq('id', destinationId)
      .select();
    
    if (error) {
      return { data: null, error };
    }
    
    if (!data || data.length === 0) {
      return { data: null, error: new Error('No se encontró el destino para actualizar o no se realizaron cambios.') };
    }
    
    return { data: data[0], error: null };
  } catch (error: any) {
    console.error('❌ Error en updateDestination:', error);
    return { data: null, error };
  }
};

export const deleteDestination = async (destinationId: string) => {
  try {
    const { error } = await supabase
      .from('destinations')
      .delete()
      .eq('id', destinationId);
    
    return { error };
  } catch (error: any) {
    console.error('❌ Error en deleteDestination:', error);
    return { error };
  }
};

export const addDestinationImage = async (destinationId: string, imageData: any) => {
  try {
    const { data, error } = await supabase
      .from('destination_images')
      .insert({
        destination_id: destinationId,
        ...imageData
      })
      .select()
      .single();
    
    return { data, error };
  } catch (error: any) {
    console.error('❌ Error en addDestinationImage:', error);
    return { data: null, error };
  }
};

export const deleteDestinationImage = async (imageId: string) => {
  try {
    const { error } = await supabase
      .from('destination_images')
      .delete()
      .eq('id', imageId);
    
    return { error };
  } catch (error: any) {
    console.error('❌ Error en deleteDestinationImage:', error);
    return { error };
  }
};

// Notification functions
export const getUserNotifications = async (limit = 10, offset = 0, includeRead = false) => {
  try {
    const { data, error } = await supabase.rpc('get_user_notifications', { 
      limit_count: limit,
      offset_count: offset,
      include_read: includeRead
    });
    
    return { data, error };
  } catch (error: any) {
    console.error('❌ Error en getUserNotifications:', error);
    return { data: null, error };
  }
};

export const markNotificationAsRead = async (notificationId: string) => {
  try {
    const { data, error } = await supabase.rpc('mark_notification_as_read', { 
      notification_id: notificationId 
    });
    
    return { data, error };
  } catch (error: any) {
    console.error('❌ Error en markNotificationAsRead:', error);
    return { data: null, error };
  }
};

export const markAllNotificationsAsRead = async () => {
  try {
    const { data, error } = await supabase.rpc('mark_all_notifications_as_read');
    
    return { data, error };
  } catch (error: any) {
    console.error('❌ Error en markAllNotificationsAsRead:', error);
    return { data: null, error };
  }
};

export const getUnreadNotificationCount = async () => {
  try {
    const { data, error } = await supabase.rpc('get_unread_notifications_count');
    
    return { data, error };
  } catch (error: any) {
    console.error('❌ Error en getUnreadNotificationCount:', error);
    return { data: null, error };
  }
};

// Helper function to get image source (base64 or URL)
export const getImageSrc = (base64?: string, url?: string): string => {
  if (base64) {
    return base64;
  }
  if (url) {
    return url;
  }
  return 'https://images.pexels.com/photos/1271619/pexels-photo-1271619.jpeg'; // Default image
};

// Tour Categories functions
export const getTourCategories = async (includeInactive: boolean = false) => {
  try {
    let query = supabase
      .from('tour_categories')
      .select('*')
      .order('display_order', { ascending: true });

    if (!includeInactive) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;
    return { data, error };
  } catch (error: any) {
    console.error('❌ Error en getTourCategories:', error);
    return { data: null, error };
  }
};

export const createTourCategory = async (categoryData: {
  name: string;
  slug: string;
  description?: string;
  display_order?: number;
}) => {
  try {
    const { data, error } = await supabase
      .from('tour_categories')
      .insert(categoryData)
      .select()
      .single();

    return { data, error };
  } catch (error: any) {
    console.error('❌ Error en createTourCategory:', error);
    return { data: null, error };
  }
};

export const updateTourCategory = async (
  id: string,
  categoryData: Partial<{
    name: string;
    slug: string;
    description: string;
    is_active: boolean;
    display_order: number;
  }>
) => {
  try {
    const { data, error } = await supabase
      .from('tour_categories')
      .update(categoryData)
      .eq('id', id)
      .select()
      .single();

    return { data, error };
  } catch (error: any) {
    console.error('❌ Error en updateTourCategory:', error);
    return { data: null, error };
  }
};

export const deleteTourCategory = async (id: string) => {
  try {
    // Verificar si hay tours usando esta categoría
    const { data: tours } = await supabase
      .from('tours')
      .select('id')
      .contains('category', [id])
      .limit(1);

    if (tours && tours.length > 0) {
      return {
        data: null,
        error: { message: 'No se puede eliminar la categoría porque tiene tours asociados' }
      };
    }

    const { error } = await supabase
      .from('tour_categories')
      .delete()
      .eq('id', id);

    return { error };
  } catch (error: any) {
    console.error('❌ Error en deleteTourCategory:', error);
    return { error };
  }
};

// Booking Cancellation Functions

interface CancellationPolicy {
  policyType: '100_percent' | '50_percent' | 'no_refund' | 'no_show' | 'pending_approval';
  refundPercentage: number;
  daysBeforeTour: number;
  originalDepositAmount: number;
  installmentsPaid: number;
  principalPaid: number;
  originalServiceCharge: number;
  refundAmountToTraveler: number;
  amountToAgency: number;
  amountToPlatform: number;
  canCancel: boolean;
  warningMessage?: string;
  refundMessage: string;
  optionalServicesRefundable?: number;
  optionalServicesNonRefundable?: number;
}

export const validateCancellationEligibility = async (bookingId: string) => {
  try {
    const { data: booking, error } = await supabase
      .from('bookings')
      .select(`
        *,
        tours:tour_id(id, name, start_date, cancellation_not_allowed)
      `)
      .eq('id', bookingId)
      .single();

    if (error || !booking) {
      return {
        eligible: false,
        error: 'No se encontró la reserva',
        booking: null
      };
    }

    if (booking.status === 'cancelled') {
      return {
        eligible: false,
        error: 'Esta reserva ya fue cancelada',
        booking
      };
    }

    if (booking.is_no_show) {
      return {
        eligible: false,
        error: 'Esta reserva ya está marcada como No Show',
        booking
      };
    }

    if (booking.approval_status === 'rejected') {
      return {
        eligible: false,
        error: 'Esta reserva fue rechazada por la agencia y no puede ser cancelada',
        booking
      };
    }

    if (!['pending', 'confirmed'].includes(booking.status)) {
      return {
        eligible: false,
        error: 'Esta reserva no puede ser cancelada debido a su estado actual',
        booking
      };
    }

    const tourStartDate = parseDateFromDB((booking.tours as any).start_date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (tourStartDate < today) {
      return {
        eligible: false,
        error: 'No se puede cancelar una reserva de un tour que ya pasó',
        booking
      };
    }

    return {
      eligible: true,
      error: null,
      booking
    };
  } catch (error: any) {
    console.error('❌ Error en validateCancellationEligibility:', error);
    return {
      eligible: false,
      error: error.message || 'Error al validar la elegibilidad de cancelación',
      booking: null
    };
  }
};

export const calculateCancellationPolicy = async (booking: any): Promise<CancellationPolicy> => {
  const tour = booking.tours;
  const isReceptivo = tour.tour_type === 'receptivo';

  const originalDepositAmount = Number(booking.deposit_amount || 0);
  let originalServiceCharge = Number(booking.service_charge || 0);
  const isPending = booking.approval_status === 'pending';

  // When has_payment_plan, installment 1 ("Anticipo") already represents the
  // deposit — adding deposit_amount on top would double-count it.
  let installmentsPaid = 0;
  if (booking.has_payment_plan) {
    const { data: installments } = await supabase
      .from('booking_payment_plan_installments')
      .select('installment_number, amount_paid')
      .eq('booking_id', booking.id)
      .in('status', ['paid', 'partially_paid']);
    for (const inst of (installments || [])) {
      if ((inst as any).installment_number > 1) {
        installmentsPaid += Number((inst as any).amount_paid || 0);
      }
    }

    // Add service charges from completed payment plan transactions
    const { data: ppTransactions } = await supabase
      .from('booking_payment_plan_transactions')
      .select('service_charge')
      .eq('booking_id', booking.id)
      .eq('status', 'completed');
    for (const tx of (ppTransactions || [])) {
      originalServiceCharge += Number((tx as any).service_charge || 0);
    }
  }
  const principalPaid = originalDepositAmount + installmentsPaid;

  const { data: platformSettings } = await supabase
    .from('platform_settings')
    .select('agency_commission_percentage')
    .single();

  const commissionRate = (platformSettings?.agency_commission_percentage || 15) / 100;

  // Fetch optional services for this booking (to show refund info in modal)
  const { data: optionalServicesData } = await supabase
    .from('booking_optional_services')
    .select('subtotal, tour_optional_service_id, tour_optional_services(is_refundable)')
    .eq('booking_id', booking.id)
    .eq('is_cancelled', false);

  let optionalServicesRefundable = 0;
  let optionalServicesNonRefundable = 0;

  if (optionalServicesData) {
    for (const bos of optionalServicesData) {
      const isRefundable = (bos as any).tour_optional_services?.is_refundable !== false;
      if (isRefundable) {
        optionalServicesRefundable += Number(bos.subtotal || 0);
      } else {
        optionalServicesNonRefundable += Number(bos.subtotal || 0);
      }
    }
  }

  if (isPending) {
    return {
      policyType: 'pending_approval',
      refundPercentage: 100,
      daysBeforeTour: 0,
      originalDepositAmount: 0,
      installmentsPaid: 0,
      principalPaid: 0,
      originalServiceCharge: 0,
      refundAmountToTraveler: 0,
      amountToAgency: 0,
      amountToPlatform: 0,
      canCancel: true,
      optionalServicesRefundable: 0,
      optionalServicesNonRefundable: 0,
      refundMessage: 'Esta reserva está pendiente de aprobación y no ha sido pagada. Puedes cancelarla sin ninguna penalización.'
    };
  }

  if (isReceptivo) {
    const selectedDate = booking.selected_date;
    const selectedTime = booking.selected_time || '00:00:00';
    const now = new Date();

    let departureDateTime: Date;
    if (selectedDate) {
      departureDateTime = new Date(`${selectedDate}T${selectedTime}`);
    } else {
      const tourStartDate = parseDateFromDB(tour.start_date);
      departureDateTime = tourStartDate;
    }

    const millisecondsPerHour = 1000 * 60 * 60;
    const hoursBeforeTour = (departureDateTime.getTime() - now.getTime()) / millisecondsPerHour;

    const flexibleHours = Number(tour.flexible_hours ?? 48);
    const flexibleRefundPct = Number(tour.flexible_refund_percentage ?? 100) / 100;
    const moderateHours = Number(tour.moderate_hours ?? 24);
    const moderateRefundPct = Number(tour.moderate_refund_percentage ?? 50) / 100;

    if (hoursBeforeTour >= flexibleHours) {
      const refundAmount = principalPaid * flexibleRefundPct;
      const penaltyAmount = principalPaid * (1 - flexibleRefundPct);
      const totalRefund = refundAmount + optionalServicesRefundable;
      return {
        policyType: flexibleRefundPct >= 1 ? '100_percent' : '50_percent',
        refundPercentage: Math.round(flexibleRefundPct * 100),
        daysBeforeTour: Math.ceil(hoursBeforeTour / 24),
        originalDepositAmount,
        installmentsPaid,
        principalPaid,
        originalServiceCharge,
        refundAmountToTraveler: totalRefund,
        amountToAgency: penaltyAmount * 0.7,
        amountToPlatform: penaltyAmount * 0.3,
        canCancel: true,
        optionalServicesRefundable,
        optionalServicesNonRefundable,
        refundMessage: `Se reembolsará el ${Math.round(flexibleRefundPct * 100)}% de lo pagado (${formatCurrency(principalPaid)} = ${formatCurrency(refundAmount)})${optionalServicesRefundable > 0 ? ` más los servicios opcionales reembolsables (${formatCurrency(optionalServicesRefundable)})` : ''} a tu ToursRed Cash. El cargo por servicio (${formatCurrency(originalServiceCharge)}) no es reembolsable.${optionalServicesNonRefundable > 0 ? ` Los servicios no reembolsables (${formatCurrency(optionalServicesNonRefundable)}) no se devuelven.` : ''}`
      };
    }

    if (hoursBeforeTour >= moderateHours) {
      const refundAmount = principalPaid * moderateRefundPct;
      const penaltyAmount = principalPaid * (1 - moderateRefundPct);
      const totalRefund = refundAmount + optionalServicesRefundable;
      return {
        policyType: moderateRefundPct > 0 ? '50_percent' : 'no_refund',
        refundPercentage: Math.round(moderateRefundPct * 100),
        daysBeforeTour: Math.ceil(hoursBeforeTour / 24),
        originalDepositAmount,
        installmentsPaid,
        principalPaid,
        originalServiceCharge,
        refundAmountToTraveler: totalRefund,
        amountToAgency: penaltyAmount * 0.7,
        amountToPlatform: penaltyAmount * 0.3,
        canCancel: true,
        optionalServicesRefundable,
        optionalServicesNonRefundable,
        refundMessage: `Se reembolsará el ${Math.round(moderateRefundPct * 100)}% de lo pagado (${formatCurrency(principalPaid)} = ${formatCurrency(refundAmount)})${optionalServicesRefundable > 0 ? ` más los servicios opcionales reembolsables (${formatCurrency(optionalServicesRefundable)})` : ''} a tu ToursRed Cash. El cargo por servicio (${formatCurrency(originalServiceCharge)}) no es reembolsable.${optionalServicesNonRefundable > 0 ? ` Los servicios no reembolsables (${formatCurrency(optionalServicesNonRefundable)}) no se devuelven.` : ''}`
      };
    }

    if (hoursBeforeTour > 0) {
      const agencyAmount = principalPaid * (1 - commissionRate);
      const platformCommission = principalPaid * commissionRate;
      return {
        policyType: 'no_refund',
        refundPercentage: 0,
        daysBeforeTour: Math.ceil(hoursBeforeTour / 24),
        originalDepositAmount,
        installmentsPaid,
        principalPaid,
        originalServiceCharge,
        refundAmountToTraveler: optionalServicesRefundable,
        amountToAgency: agencyAmount,
        amountToPlatform: platformCommission,
        canCancel: true,
        optionalServicesRefundable,
        optionalServicesNonRefundable,
        refundMessage: `No se reembolsará lo pagado del tour (${formatCurrency(principalPaid)}) (menos de ${moderateHours} horas antes).${optionalServicesRefundable > 0 ? ` Los servicios opcionales reembolsables (${formatCurrency(optionalServicesRefundable)}) sí se devuelven.` : ''} Cancelar evita una penalización de No Show en tu perfil.`
      };
    }

    return {
      policyType: 'no_show',
      refundPercentage: 0,
      daysBeforeTour: 0,
      originalDepositAmount,
      installmentsPaid,
      principalPaid,
      originalServiceCharge,
      refundAmountToTraveler: optionalServicesRefundable,
      amountToAgency: principalPaid * (1 - commissionRate),
      amountToPlatform: principalPaid * commissionRate,
      canCancel: true,
      optionalServicesRefundable,
      optionalServicesNonRefundable,
      warningMessage: 'ADVERTENCIA: Cancelar con la hora de salida ya pasada resultará en una marca de No Show en tu perfil.',
      refundMessage: 'No hay reembolso de lo pagado y se te marcará como No Show. Esto puede afectar tu capacidad de hacer reservas futuras.'
    };
  }

  // Excursion: fixed days-based policy (unchanged)
  const tourStartDate = parseDateFromDB(tour.start_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const millisecondsPerDay = 1000 * 60 * 60 * 24;
  const daysBeforeTour = Math.ceil((tourStartDate.getTime() - today.getTime()) / millisecondsPerDay);

  if (daysBeforeTour >= 15) {
    const totalRefund = principalPaid + optionalServicesRefundable;
    return {
      policyType: '100_percent',
      refundPercentage: 100,
      daysBeforeTour,
      originalDepositAmount,
      installmentsPaid,
      principalPaid,
      originalServiceCharge,
      refundAmountToTraveler: totalRefund,
      amountToAgency: 0,
      amountToPlatform: 0,
      canCancel: true,
      optionalServicesRefundable,
      optionalServicesNonRefundable,
      refundMessage: `Se reembolsará el 100% de lo pagado (${formatCurrency(principalPaid)})${optionalServicesRefundable > 0 ? ` más los servicios opcionales reembolsables (${formatCurrency(optionalServicesRefundable)})` : ''} a tu ToursRed Cash. El cargo por servicio (${formatCurrency(originalServiceCharge)}) no es reembolsable.${optionalServicesNonRefundable > 0 ? ` Los servicios no reembolsables (${formatCurrency(optionalServicesNonRefundable)}) no se devuelven.` : ''}`
    };
  }

  if (daysBeforeTour >= 7 && daysBeforeTour < 15) {
    const refundAmount = principalPaid * 0.5;
    const penaltyAmount = principalPaid * 0.5;
    const agencyShare = penaltyAmount * 0.7;
    const platformShare = penaltyAmount * 0.3;
    const totalRefund = refundAmount + optionalServicesRefundable;

    return {
      policyType: '50_percent',
      refundPercentage: 50,
      daysBeforeTour,
      originalDepositAmount,
      installmentsPaid,
      principalPaid,
      originalServiceCharge,
      refundAmountToTraveler: totalRefund,
      amountToAgency: agencyShare,
      amountToPlatform: platformShare,
      canCancel: true,
      optionalServicesRefundable,
      optionalServicesNonRefundable,
      refundMessage: `Se reembolsará el 50% de lo pagado (${formatCurrency(principalPaid)} = ${formatCurrency(refundAmount)})${optionalServicesRefundable > 0 ? ` más los servicios opcionales reembolsables (${formatCurrency(optionalServicesRefundable)})` : ''} a tu ToursRed Cash. El cargo por servicio (${formatCurrency(originalServiceCharge)}) no es reembolsable.${optionalServicesNonRefundable > 0 ? ` Los servicios no reembolsables (${formatCurrency(optionalServicesNonRefundable)}) no se devuelven.` : ''}`
    };
  }

  if (daysBeforeTour >= 1 && daysBeforeTour < 7) {
    const agencyAmount = principalPaid * (1 - commissionRate);
    const platformCommission = principalPaid * commissionRate;

    return {
      policyType: 'no_refund',
      refundPercentage: 0,
      daysBeforeTour,
      originalDepositAmount,
      installmentsPaid,
      principalPaid,
      originalServiceCharge,
      refundAmountToTraveler: optionalServicesRefundable,
      amountToAgency: agencyAmount,
      amountToPlatform: platformCommission,
      canCancel: true,
      optionalServicesRefundable,
      optionalServicesNonRefundable,
      warningMessage: tour.cancellation_not_allowed
        ? 'Este tour NO permite cancelaciones con reembolso. Solo puedes cancelar para evitar la penalización de No Show.'
        : undefined,
      refundMessage: `No se reembolsará lo pagado del tour (${formatCurrency(principalPaid)}).${optionalServicesRefundable > 0 ? ` Los servicios opcionales reembolsables (${formatCurrency(optionalServicesRefundable)}) sí se devuelven.` : ''}${optionalServicesNonRefundable > 0 ? ` Los servicios no reembolsables (${formatCurrency(optionalServicesNonRefundable)}) no se devuelven.` : ''} Cancelar evita una penalización de No Show en tu perfil.`
    };
  }

  return {
    policyType: 'no_show',
    refundPercentage: 0,
    daysBeforeTour,
    originalDepositAmount,
    installmentsPaid,
    principalPaid,
    originalServiceCharge,
    refundAmountToTraveler: optionalServicesRefundable,
    amountToAgency: principalPaid * (1 - commissionRate),
    amountToPlatform: principalPaid * commissionRate,
    canCancel: true,
    optionalServicesRefundable,
    optionalServicesNonRefundable,
    warningMessage: 'ADVERTENCIA: Cancelar con menos de 1 día de anticipación resultará en una marca de No Show en tu perfil.',
    refundMessage: 'No hay reembolso de lo pagado y se te marcará como No Show. Esto puede afectar tu capacidad de hacer reservas futuras.'
  };
};

// ─── PARTIAL CANCELLATION SYSTEM ────────────────────────────────────────────

export interface PartialCancellationTraveler {
  id: string;
  nombre: string;
  categoria_viajero: string;
  precio_aplicado: number;
}

export interface PartialCancellationPolicy {
  policyType: '100_percent' | '50_percent' | 'no_refund';
  daysBeforeTour: number;
  originalPartialAmount: number;
  refundAmountToTraveler: number;
  amountToAgency: number;
  amountToPlatform: number;
  canCancel: boolean;
  warningMessage?: string;
  refundMessage: string;
}

export const calculatePartialCancellationPolicy = async (
  booking: any,
  travelersToCancel: PartialCancellationTraveler[]
): Promise<PartialCancellationPolicy> => {
  const tour = booking.tours;
  const tourStartDate = parseDateFromDB(tour.start_date);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const millisecondsPerDay = 1000 * 60 * 60 * 24;
  const daysBeforeTour = Math.ceil((tourStartDate.getTime() - today.getTime()) / millisecondsPerDay);

  // Calcular el monto total de los viajeros a cancelar (precio completo)
  const fullPriceOfCancelledTravelers = travelersToCancel.reduce(
    (sum, t) => sum + Number(t.precio_aplicado),
    0
  );

  // El reembolso máximo posible es solo lo que el viajero realmente pagó (anticipo)
  // Si se pagó solo el anticipo, la proporción es deposit_amount / total_price
  const totalPrice = Number(booking.total_price) || 0;
  const depositAmount = Number(booking.deposit_amount) || totalPrice;
  const depositRatio = totalPrice > 0 ? depositAmount / totalPrice : 1;

  // originalPartialAmount = parte del anticipo correspondiente a estos viajeros
  const originalPartialAmount = Math.round(fullPriceOfCancelledTravelers * depositRatio * 100) / 100;

  const { data: platformSettings } = await supabase
    .from('platform_settings')
    .select('agency_commission_percentage')
    .single();

  const commissionRate = (platformSettings?.agency_commission_percentage || 15) / 100;

  const travelerNames = travelersToCancel.map(t => t.nombre).join(', ');

  if (daysBeforeTour >= 15) {
    return {
      policyType: '100_percent',
      daysBeforeTour,
      originalPartialAmount,
      refundAmountToTraveler: originalPartialAmount,
      amountToAgency: 0,
      amountToPlatform: 0,
      canCancel: true,
      refundMessage: `Se reembolsará el 100% del anticipo parcial ($${formatCurrency(originalPartialAmount)}) a tu ToursRed Cash.`
    };
  }

  if (daysBeforeTour >= 7 && daysBeforeTour < 15) {
    const refundAmount = originalPartialAmount * 0.5;
    const penaltyAmount = originalPartialAmount * 0.5;
    return {
      policyType: '50_percent',
      daysBeforeTour,
      originalPartialAmount,
      refundAmountToTraveler: refundAmount,
      amountToAgency: penaltyAmount * 0.7,
      amountToPlatform: penaltyAmount * 0.3,
      canCancel: true,
      refundMessage: `Se reembolsará el 50% del anticipo parcial ($${formatCurrency(refundAmount)}) a tu ToursRed Cash.`
    };
  }

  const agencyAmount = originalPartialAmount * (1 - commissionRate);
  const platformAmount = originalPartialAmount * commissionRate;

  return {
    policyType: 'no_refund',
    daysBeforeTour,
    originalPartialAmount,
    refundAmountToTraveler: 0,
    amountToAgency: agencyAmount,
    amountToPlatform: platformAmount,
    canCancel: true,
    warningMessage: tour.cancellation_not_allowed
      ? 'Este tour NO permite cancelaciones con reembolso.'
      : daysBeforeTour < 1
        ? 'Cancelar en este momento no genera reembolso.'
        : undefined,
    refundMessage: `No habrá reembolso por estos viajeros. La cancelación se procesa para evitar penalización de No Show.`
  };
};

export const processPartialCancellation = async (
  bookingId: string,
  userId: string,
  travelersToCancel: PartialCancellationTraveler[],
  cancellationReason?: string
): Promise<{ data: { partialCancellation: any; policy: PartialCancellationPolicy } | null; error: string | null }> => {
  try {
    console.log('🚫 Procesando cancelación parcial:', bookingId, travelersToCancel.length, 'viajeros');

    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select(`
        *,
        tours (id, name, start_date, cancellation_not_allowed),
        agencies (id, user_id)
      `)
      .eq('id', bookingId)
      .single();

    if (bookingError || !booking) {
      throw new Error('Reserva no encontrada');
    }

    if (!['confirmed', 'pending'].includes(booking.status)) {
      throw new Error('La reserva no está en un estado que permita cancelaciones parciales');
    }

    const { data: activeTravelers, error: travelersError } = await supabase
      .from('booking_travelers')
      .select('id')
      .eq('booking_id', bookingId)
      .eq('is_cancelled', false);

    if (travelersError) throw travelersError;

    const currentActiveCount = activeTravelers?.length || 0;
    if (travelersToCancel.length >= currentActiveCount) {
      throw new Error('No puedes cancelar todos los viajeros con cancelación parcial. Usa la cancelación total de la reserva.');
    }

    const policy = await calculatePartialCancellationPolicy(booking, travelersToCancel);

    let transactionId: string | null = null;

    if (policy.refundAmountToTraveler > 0) {
      const tourName = (booking.tours as any).name;
      const { data: refundData, error: refundError } = await supabase.rpc('update_wallet_balance', {
        p_user_id: userId,
        p_amount: policy.refundAmountToTraveler,
        p_type: 'refund',
        p_description: `Reembolso por cancelación parcial de ${tourName}`,
        p_reference_id: bookingId,
        p_reference_type: 'booking_partial_cancellation'
      });

      if (refundError) throw new Error(`Error al procesar reembolso: ${refundError.message}`);
      transactionId = refundData?.transaction_id || null;
      console.log('💰 Reembolso parcial procesado:', transactionId);
    }

    const { data: partialCancellation, error: insertError } = await supabase
      .from('booking_partial_cancellations')
      .insert({
        booking_id: bookingId,
        cancelled_by_user_id: userId,
        tour_start_date: (booking.tours as any).start_date,
        days_before_tour: policy.daysBeforeTour,
        cancellation_policy_type: policy.policyType,
        travelers_cancelled: travelersToCancel,
        original_partial_amount: policy.originalPartialAmount,
        refund_amount_to_traveler: policy.refundAmountToTraveler,
        amount_to_agency: policy.amountToAgency,
        amount_to_platform: policy.amountToPlatform,
        toursred_cash_transaction_id: transactionId,
        refund_processed: policy.refundAmountToTraveler > 0,
        cancellation_reason: cancellationReason || null
      })
      .select()
      .single();

    if (insertError) throw insertError;

    // Generar póliza contable solo cuando hay retención (50% o sin reembolso)
    if (policy.policyType === '50_percent' || policy.policyType === 'no_refund') {
      supabase.rpc('create_accounting_entry_for_cancellation', {
        p_cancellation_id: partialCancellation.id,
        p_cancellation_type: 'partial'
      }).then(({ error: accErr }) => {
        if (accErr) console.error('⚠️ Error generando póliza contable de cancelación parcial:', accErr);
      });
    }

    // Descontar puntos correspondientes al anticipo de los viajeros cancelados
    // La tasa de puntos es 1 peso pagado = 1 punto ganado (FLOOR del monto)
    // originalPartialAmount ya refleja el precio exacto de esos viajeros × ratio de anticipo
    const pointsEarned = Number(booking.points_earned) || 0;
    if (pointsEarned > 0) {
      // Puntos a restar = anticipo pagado por los viajeros cancelados (1:1 con pesos)
      // Limitado a los puntos realmente disponibles en la reserva para no pasarse
      const pointsToDeduct = Math.min(
        Math.floor(policy.originalPartialAmount),
        pointsEarned
      );

      if (pointsToDeduct > 0) {
        const { error: deductError } = await supabase.rpc('deduct_points_for_partial_cancellation', {
          p_booking_id: bookingId,
          p_partial_cancellation_id: partialCancellation.id,
          p_user_id: userId,
          p_points_to_deduct: pointsToDeduct
        });
        if (deductError) {
          console.error('⚠️ Error descontando puntos (no crítico):', deductError);
        } else {
          await supabase
            .from('bookings')
            .update({ points_earned: pointsEarned - pointsToDeduct })
            .eq('id', bookingId);
        }
      }
    }

    const travelerIds = travelersToCancel.map(t => t.id);
    const { error: updateTravelersError } = await supabase
      .from('booking_travelers')
      .update({
        is_cancelled: true,
        cancelled_at: new Date().toISOString(),
        partial_cancellation_id: partialCancellation.id
      })
      .in('id', travelerIds);

    if (updateTravelersError) throw updateTravelersError;

    const newActiveCount = currentActiveCount - travelersToCancel.length;
    const { error: updateBookingError } = await supabase
      .from('bookings')
      .update({
        has_partial_cancellations: true,
        active_travelers_count: newActiveCount
      })
      .eq('id', bookingId);

    if (updateBookingError) throw updateBookingError;

    if (policy.amountToAgency > 0 && (policy.policyType === '50_percent' || policy.policyType === 'no_refund')) {
      const { error: penaltyError } = await supabase
        .from('cancellation_penalty_records')
        .insert({
          booking_id: bookingId,
          agency_id: booking.agency_id,
          tour_id: (booking.tours as any).id,
          cancellation_type: 'partial',
          partial_cancellation_id: partialCancellation.id,
          cancellation_policy_type: policy.policyType,
          original_booking_amount: policy.originalPartialAmount,
          gross_penalty: policy.originalPartialAmount - policy.refundAmountToTraveler,
          agency_net_amount: policy.amountToAgency,
          platform_amount: policy.amountToPlatform,
          status: 'pending'
        });

      if (penaltyError) {
        throw new Error(`Error creando cancellation_penalty_record (parcial): ${penaltyError.message}`);
      }
    }

    try {
      const agencyUserId = (booking.agencies as any)?.user_id;
      if (agencyUserId) {
        await supabase.rpc('create_user_notification', {
          p_user_id: agencyUserId,
          p_type: 'booking_cancelled',
          p_title: 'Cancelación Parcial de Viajeros',
          p_message: `Se cancelaron ${travelersToCancel.length} viajero(s) de la reserva del tour "${(booking.tours as any).name}".`,
          p_data: {
            booking_id: bookingId,
            partial_cancellation_id: partialCancellation.id,
            travelers_count: travelersToCancel.length,
            refund_amount: policy.refundAmountToTraveler,
            policy_type: policy.policyType
          }
        });

        await supabase
          .from('booking_partial_cancellations')
          .update({ notification_sent: true })
          .eq('id', partialCancellation.id);
      }
    } catch (notifError) {
      console.error('⚠️ Error enviando notificación en tiempo real (no crítico):', notifError);
    }

    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

      const responses = await Promise.all([
        fetch(`${supabaseUrl}/functions/v1/send-partial-cancellation-notification-traveler`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseAnonKey}` },
          body: JSON.stringify({ booking_id: bookingId, partial_cancellation_id: partialCancellation.id })
        }),
        fetch(`${supabaseUrl}/functions/v1/send-partial-cancellation-notification-agency`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseAnonKey}` },
          body: JSON.stringify({ booking_id: bookingId, partial_cancellation_id: partialCancellation.id })
        }),
        fetch(`${supabaseUrl}/functions/v1/send-partial-cancellation-notification-admin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseAnonKey}` },
          body: JSON.stringify({ booking_id: bookingId, partial_cancellation_id: partialCancellation.id })
        })
      ]);

      const allSent = responses.every(r => r.ok);
      await supabase
        .from('booking_partial_cancellations')
        .update({ emails_sent: allSent })
        .eq('id', partialCancellation.id);
    } catch (emailError) {
      console.error('⚠️ Error enviando emails de cancelación parcial (no crítico):', emailError);
    }

    console.log('✅ Cancelación parcial completada exitosamente');

    return {
      data: { partialCancellation, policy },
      error: null
    };
  } catch (error: any) {
    console.error('❌ Error en processPartialCancellation:', error);
    return {
      data: null,
      error: error.message || 'Error al procesar la cancelación parcial'
    };
  }
};