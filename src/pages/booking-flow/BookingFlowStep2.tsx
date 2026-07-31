import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, ChevronLeft, UserPlus, AlertCircle, Users as UsersIcon } from 'lucide-react';
import { useBookingFlow } from '../../context/BookingFlowContext';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { validateBirthDateForCategory } from '../../utils/birthDateValidation';
import { totalTravelerCount, FlowTraveler, TravelerCategory, TravelerCounts } from '../../types/booking-flow';
import type { Tour, FrequentCompanion } from '../../types';

const CATEGORY_LABELS: Record<TravelerCategory, string> = {
  adulto: 'Adulto',
  nino: 'Nino',
  infante: 'Infante',
  adulto_mayor: 'Adulto Mayor',
  mascota: 'Mascota',
};

const getPrecio = (tour: Tour, categoria: TravelerCategory): number => {
  switch (categoria) {
    case 'adulto': return tour.precio_adulto ?? tour.price;
    case 'nino': return tour.precio_nino ?? 0;
    case 'infante': return tour.precio_infante ?? 0;
    case 'adulto_mayor': return tour.precio_adulto_mayor ?? tour.precio_adulto ?? tour.price;
    case 'mascota': return tour.precio_mascota ?? 0;
  }
};

function createEmptyTraveler(categoria: TravelerCategory, precio: number, email: string): FlowTraveler {
  return {
    nombre: '',
    apellido: '',
    email,
    telefono: '',
    fecha_nacimiento: '',
    tipo_documento: '',
    numero_documento: '',
    curp: '',
    pasaporte: '',
    categoria_viajero: categoria,
    contacto_emergencia_nombre: '',
    contacto_emergencia_telefono: '',
    sexo: '',
    precio_aplicado: precio,
  };
}

function buildTravelerList(counts: TravelerCounts, tour: Tour, userEmail: string): FlowTraveler[] {
  const list: FlowTraveler[] = [];
  const cats: { key: keyof TravelerCounts; cat: TravelerCategory }[] = [
    { key: 'adultos', cat: 'adulto' },
    { key: 'ninos', cat: 'nino' },
    { key: 'infantes', cat: 'infante' },
    { key: 'adultos_mayores', cat: 'adulto_mayor' },
    { key: 'mascotas', cat: 'mascota' },
  ];
  for (const { key, cat } of cats) {
    for (let i = 0; i < counts[key]; i++) {
      list.push(createEmptyTraveler(cat, getPrecio(tour, cat), userEmail));
    }
  }
  return list;
}

const BookingFlowStep2: React.FC = () => {
  const { flow, updateFlow, goToStep } = useBookingFlow();
  const { user } = useAuth();
  const navigate = useNavigate();

  const tour = flow.tour;
  const [travelers, setTravelers] = useState<FlowTraveler[]>(flow.travelers);
  const [errors, setErrors] = useState<string[]>([]);
  const [globalError, setGlobalError] = useState('');
  const [frequentCompanions, setFrequentCompanions] = useState<FrequentCompanion[]>([]);
  const [isLoadingCompanions, setIsLoadingCompanions] = useState(true);
  const [userProfile, setUserProfile] = useState<{
    first_name?: string; last_name?: string; email?: string; phone_number?: string;
    date_of_birth?: string; curp?: string; passport_number?: string;
    is_foreign_traveler?: boolean; emergency_contact_name?: string; emergency_contact_phone?: string;
  } | null>(null);

  const totalTravelers = totalTravelerCount(flow.travelerCounts);

  useEffect(() => {
    if (!tour || !user) return;

    if (flow.travelers.length === totalTravelers && flow.travelers.length > 0) {
      setTravelers(flow.travelers);
      setIsLoadingCompanions(false);
      return;
    }

    const loadUserProfileAndInit = async () => {
      try {
        const { data: userData } = await supabase
          .from('users')
          .select('first_name, last_name, email, phone_number, date_of_birth, curp, passport_number, is_foreign_traveler, emergency_contact_name, emergency_contact_phone')
          .eq('id', user.id)
          .maybeSingle();

        setUserProfile(userData);

        const list = buildTravelerList(flow.travelerCounts, tour, user.email || '');

        if (userData && list.length > 0 && list[0].categoria_viajero === 'adulto') {
          list[0] = {
            ...list[0],
            nombre: userData.first_name || '',
            apellido: userData.last_name || '',
            email: userData.email || user.email || '',
            telefono: userData.phone_number || '',
            fecha_nacimiento: userData.date_of_birth || '',
            tipo_documento: userData.is_foreign_traveler ? 'pasaporte' : 'curp',
            numero_documento: userData.is_foreign_traveler ? (userData.passport_number || '') : (userData.curp || ''),
            curp: userData.curp || '',
            pasaporte: userData.passport_number || '',
            contacto_emergencia_nombre: userData.emergency_contact_name || '',
            contacto_emergencia_telefono: userData.emergency_contact_phone || '',
          };
        }

        setTravelers(list);
        updateFlow({ travelers: list });
      } catch {
        const list = buildTravelerList(flow.travelerCounts, tour, user.email || '');
        setTravelers(list);
        updateFlow({ travelers: list });
      } finally {
        setIsLoadingCompanions(false);
      }
    };

    loadUserProfileAndInit();

    const loadCompanions = async () => {
      try {
        const { data, error } = await supabase
          .from('frequent_companions')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });
        if (!error && data) setFrequentCompanions(data);
      } catch {
        // non-critical
      }
    };
    loadCompanions();
  }, [tour, user]);

  const handleTravelerChange = (index: number, field: keyof FlowTraveler, value: string) => {
    const updated = [...travelers];
    updated[index] = { ...updated[index], [field]: value };
    setTravelers(updated);

    if (field === 'fecha_nacimiento' && value) {
      const result = validateBirthDateForCategory(value, updated[index].categoria_viajero, tour?.start_date);
      const newErrors = [...errors];
      if (!result.isValid) {
        newErrors[index] = result.errorMessage || 'Fecha invalida';
      } else {
        newErrors[index] = '';
      }
      setErrors(newErrors);
    }
  };

  const handleCompanionSelect = (index: number, companion: FrequentCompanion) => {
    const updated = [...travelers];
    updated[index] = {
      ...updated[index],
      nombre: companion.nombre,
      apellido: companion.apellido || '',
      email: companion.email,
      telefono: companion.telefono || '',
      fecha_nacimiento: companion.fecha_nacimiento,
      tipo_documento: companion.documento_tipo || '',
      numero_documento: companion.documento_numero || '',
      curp: companion.documento_tipo === 'curp' ? (companion.documento_numero || '') : '',
      pasaporte: companion.documento_tipo === 'pasaporte' ? (companion.documento_numero || '') : '',
      contacto_emergencia_nombre: companion.emergency_contact_name || '',
      contacto_emergencia_telefono: companion.emergency_contact_phone || '',
    };
    setTravelers(updated);
  };

  const validateAll = (): boolean => {
    const newErrors: string[] = [];
    let isValid = true;

    for (let i = 0; i < travelers.length; i++) {
      const t = travelers[i];
      let err = '';

      if (!t.nombre.trim()) err = 'Nombre requerido';
      else if (!t.apellido.trim() && t.categoria_viajero !== 'mascota') err = 'Apellido requerido';
      else if (!t.email.trim()) err = 'Email requerido';
      else if (t.categoria_viajero !== 'mascota' && !t.fecha_nacimiento) err = 'Fecha de nacimiento requerida';
      else if (t.categoria_viajero !== 'mascota' && t.fecha_nacimiento) {
        const result = validateBirthDateForCategory(t.fecha_nacimiento, t.categoria_viajero, tour?.start_date);
        if (!result.isValid) err = result.errorMessage || 'Fecha invalida';
      }

      newErrors[i] = err;
      if (err) isValid = false;
    }

    setErrors(newErrors);
    return isValid;
  };

  const handleContinue = () => {
    setGlobalError('');

    if (travelers.length === 0) {
      setGlobalError('No hay viajeros para registrar. Vuelve al paso 1.');
      return;
    }

    if (!validateAll()) {
      setGlobalError('Por favor corrige los errores en los formularios antes de continuar.');
      return;
    }

    updateFlow({ travelers });
    goToStep(3);
    navigate(`/reservar/${flow.tourSlug}/paso-3`);
  };

  const handleBack = () => {
    updateFlow({ travelers });
    goToStep(1);
    navigate(`/reservar/${flow.tourSlug}/paso-1`);
  };

  if (!tour) return null;

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="p-6">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Datos de los viajeros</h1>
        <p className="text-sm text-gray-500 mb-6">Paso 2 de 4 — Informacion de cada viajero</p>

        {globalError && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-start gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            {globalError}
          </div>
        )}

        {isLoadingCompanions ? (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-600"></div>
          </div>
        ) : (
          <div className="space-y-6">
            {travelers.map((traveler, index) => (
              <div key={index} className="border border-gray-200 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-4">
                  <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-sm font-bold">
                    {index + 1}
                  </div>
                  <span className="font-semibold text-gray-800">
                    {CATEGORY_LABELS[traveler.categoria_viajero]}
                  </span>
                </div>

                {/* Frequent companions selector (except first adult which is pre-filled) */}
                {frequentCompanions.length > 0 && index > 0 && traveler.categoria_viajero !== 'mascota' && (
                  <div className="mb-4">
                    <label className="block text-xs font-medium text-gray-500 mb-1">Companero frecuente (opcional)</label>
                    <select
                      value=""
                      onChange={(e) => {
                        const comp = frequentCompanions.find(c => c.id === e.target.value);
                        if (comp) handleCompanionSelect(index, comp);
                      }}
                      className="input text-sm"
                    >
                      <option value="">Seleccionar...</option>
                      {frequentCompanions.map(c => (
                        <option key={c.id} value={c.id}>{c.nombre} {c.apellido || ''}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Nombre *</label>
                    <input
                      type="text"
                      value={traveler.nombre}
                      onChange={(e) => handleTravelerChange(index, 'nombre', e.target.value)}
                      className="input text-sm"
                      placeholder="Nombre"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      Apellido {traveler.categoria_viajero !== 'mascota' ? '*' : ''}
                    </label>
                    <input
                      type="text"
                      value={traveler.apellido}
                      onChange={(e) => handleTravelerChange(index, 'apellido', e.target.value)}
                      className="input text-sm"
                      placeholder="Apellido"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Email *</label>
                    <input
                      type="email"
                      value={traveler.email}
                      onChange={(e) => handleTravelerChange(index, 'email', e.target.value)}
                      className="input text-sm"
                      placeholder="correo@ejemplo.com"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Telefono</label>
                    <input
                      type="tel"
                      value={traveler.telefono}
                      onChange={(e) => handleTravelerChange(index, 'telefono', e.target.value)}
                      className="input text-sm"
                      placeholder="Telefono"
                    />
                  </div>
                  {traveler.categoria_viajero !== 'mascota' && (
                    <>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Fecha de nacimiento *</label>
                        <input
                          type="date"
                          value={traveler.fecha_nacimiento}
                          onChange={(e) => handleTravelerChange(index, 'fecha_nacimiento', e.target.value)}
                          className="input text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Sexo</label>
                        <select
                          value={traveler.sexo}
                          onChange={(e) => handleTravelerChange(index, 'sexo', e.target.value as 'masculino' | 'femenino' | '')}
                          className="input text-sm"
                        >
                          <option value="">Seleccionar...</option>
                          <option value="masculino">Masculino</option>
                          <option value="femenino">Femenino</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Tipo de documento</label>
                        <select
                          value={traveler.tipo_documento}
                          onChange={(e) => handleTravelerChange(index, 'tipo_documento', e.target.value as 'curp' | 'pasaporte' | '')}
                          className="input text-sm"
                        >
                          <option value="">Seleccionar...</option>
                          <option value="curp">CURP</option>
                          <option value="pasaporte">Pasaporte</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Numero de documento</label>
                        <input
                          type="text"
                          value={traveler.numero_documento}
                          onChange={(e) => {
                            const updated = [...travelers];
                            const tipo = traveler.tipo_documento;
                            updated[index] = {
                              ...updated[index],
                              numero_documento: e.target.value,
                              curp: tipo === 'curp' ? e.target.value : updated[index].curp,
                              pasaporte: tipo === 'pasaporte' ? e.target.value : updated[index].pasaporte,
                            };
                            setTravelers(updated);
                          }}
                          className="input text-sm"
                          placeholder={traveler.tipo_documento === 'pasaporte' ? 'Numero de pasaporte' : 'CURP'}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Contacto de emergencia (nombre)</label>
                        <input
                          type="text"
                          value={traveler.contacto_emergencia_nombre}
                          onChange={(e) => handleTravelerChange(index, 'contacto_emergencia_nombre', e.target.value)}
                          className="input text-sm"
                          placeholder="Nombre del contacto"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Contacto de emergencia (telefono)</label>
                        <input
                          type="tel"
                          value={traveler.contacto_emergencia_telefono}
                          onChange={(e) => handleTravelerChange(index, 'contacto_emergencia_telefono', e.target.value)}
                          className="input text-sm"
                          placeholder="Telefono del contacto"
                        />
                      </div>
                    </>
                  )}
                </div>

                {errors[index] && (
                  <div className="mt-2 text-sm text-red-600 flex items-center gap-1">
                    <AlertCircle className="w-4 h-4" />
                    {errors[index]}
                  </div>
                )}
              </div>
            ))}

            {/* Navigation */}
            <div className="flex gap-3 pt-4">
              <button
                onClick={handleBack}
                className="flex items-center gap-1.5 px-5 py-3 border border-gray-300 text-gray-700 font-medium rounded-xl hover:bg-gray-50 transition-colors"
              >
                <ChevronLeft className="w-5 h-5" />
                Atras
              </button>
              <button
                onClick={handleContinue}
                className="flex-1 flex items-center justify-center gap-2 py-3.5 bg-primary-600 text-white font-semibold rounded-xl hover:bg-primary-700 transition-colors"
              >
                Continuar al Paso 3
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BookingFlowStep2;
