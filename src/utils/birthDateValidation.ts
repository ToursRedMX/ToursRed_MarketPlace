type TravelerCategory = 'adulto' | 'nino' | 'infante' | 'adulto_mayor' | 'mascota';

interface ValidationResult {
  isValid: boolean;
  errorMessage: string;
}

function calculateAgeAtDate(birthDate: Date, referenceDate: Date): { years: number; months: number } {
  let years = referenceDate.getFullYear() - birthDate.getFullYear();
  let months = referenceDate.getMonth() - birthDate.getMonth();

  if (referenceDate.getDate() < birthDate.getDate()) {
    months--;
  }

  if (months < 0) {
    years--;
    months += 12;
  }

  return { years, months };
}

const categoryLabels: Record<string, string> = {
  adulto: 'Adulto',
  nino: 'Niño',
  infante: 'Infante',
  adulto_mayor: 'Adulto Mayor',
  mascota: 'Mascota',
};

export function validateBirthDateForCategory(
  fechaNacimiento: string,
  categoria: TravelerCategory,
  referenceDate?: string
): ValidationResult {
  if (categoria === 'mascota') {
    return { isValid: true, errorMessage: '' };
  }

  if (!fechaNacimiento) {
    return { isValid: false, errorMessage: 'La fecha de nacimiento es requerida.' };
  }

  const birthDate = new Date(fechaNacimiento + 'T00:00:00');
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (birthDate > today) {
    return {
      isValid: false,
      errorMessage: 'La fecha de nacimiento no puede ser posterior al día de hoy.',
    };
  }

  const ageAtToday = calculateAgeAtDate(birthDate, today);
  if (ageAtToday.years > 120) {
    return {
      isValid: false,
      errorMessage: 'La fecha de nacimiento resulta en una edad mayor a 120 años. Por favor verifica.',
    };
  }

  const refDate = referenceDate ? new Date(referenceDate + 'T00:00:00') : today;
  const { years, months } = calculateAgeAtDate(birthDate, refDate);
  const totalMonths = years * 12 + months;
  const label = categoryLabels[categoria] || categoria;

  switch (categoria) {
    case 'infante':
      if (totalMonths >= 36) {
        return {
          isValid: false,
          errorMessage: `La fecha de nacimiento indica ${years} año${years !== 1 ? 's' : ''} y ${months} mes${months !== 1 ? 'es' : ''}. Para la categoría "${label}", el viajero debe tener menos de 3 años al día del tour.`,
        };
      }
      break;

    case 'nino':
      if (totalMonths < 36) {
        return {
          isValid: false,
          errorMessage: `La fecha de nacimiento indica ${years} año${years !== 1 ? 's' : ''} y ${months} mes${months !== 1 ? 'es' : ''}. Para la categoría "${label}", el viajero debe tener al menos 3 años cumplidos.`,
        };
      }
      if (years >= 12) {
        return {
          isValid: false,
          errorMessage: `La fecha de nacimiento indica ${years} años. Para la categoría "${label}", el viajero debe tener menos de 12 años cumplidos al día del tour.`,
        };
      }
      break;

    case 'adulto':
      if (years < 12) {
        return {
          isValid: false,
          errorMessage: `La fecha de nacimiento indica ${years} año${years !== 1 ? 's' : ''}. Para la categoría "${label}", el viajero debe tener al menos 12 años cumplidos.`,
        };
      }
      if (years >= 60) {
        return {
          isValid: false,
          errorMessage: `La fecha de nacimiento indica ${years} años. Para la categoría "${label}", el viajero debe tener menos de 60 años. A partir de 60 años corresponde "Adulto Mayor".`,
        };
      }
      break;

    case 'adulto_mayor':
      if (years < 60) {
        return {
          isValid: false,
          errorMessage: `La fecha de nacimiento indica ${years} año${years !== 1 ? 's' : ''}. Para la categoría "${label}", el viajero debe tener al menos 60 años cumplidos.`,
        };
      }
      break;
  }

  return { isValid: true, errorMessage: '' };
}

export function validateAllTravelers(
  travelers: Array<{ categoria_viajero: TravelerCategory; fecha_nacimiento: string }>,
  tourStartDate?: string
): { isValid: boolean; errors: string[] } {
  const errors: string[] = new Array(travelers.length).fill('');
  let isValid = true;

  for (let i = 0; i < travelers.length; i++) {
    const t = travelers[i];
    if (t.categoria_viajero === 'mascota') continue;
    if (!t.fecha_nacimiento) continue;

    const result = validateBirthDateForCategory(t.fecha_nacimiento, t.categoria_viajero, tourStartDate);
    if (!result.isValid) {
      errors[i] = result.errorMessage;
      isValid = false;
    }
  }

  return { isValid, errors };
}
