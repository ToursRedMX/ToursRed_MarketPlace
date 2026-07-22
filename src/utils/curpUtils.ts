// CURP prefix calculation following RENAPO official algorithm
// Calculates the first 11 characters: 4 letters (apellidos+nombre) + 6 date digits + 1 sex letter

const PALABRAS_INCONVENIENTES = [
  'BACA','BAKA','BUEI','BUEY','CACA','CACO','CAGA','CAGO','CAKA','CAKO',
  'COGE','COGI','COJA','COJE','COJI','COJO','COLA','CULO','FALO','FETO',
  'GETA','GUEI','GUEY','JETA','JOTO','KACA','KACO','KAGA','KAGO','KAKA',
  'KAKO','KOGE','KOGI','KOJA','KOJE','KOJI','KOJO','KOLA','KULO','LELO',
  'LOCA','LOCO','LOKA','LOKO','MAME','MAMO','MEAR','MEAS','MEON','MIAR',
  'MION','MOCO','MOKO','MULA','MULO','NACA','NACO','PEDA','PEDO','PENE',
  'PIPI','PITO','POPO','PUTA','PUTO','QULO','RATA','ROBA','ROBE','ROBO',
  'RUIN','SENO','TETA','VACA','VAGA','VAGO','VAKA','VUEI','VUEY','WUEI','WUEY',
];

const PREFIJOS = [
  'DA','DAS','DE','DEL','DER','DI','DIE','DD','EL','LA','LOS','LAS',
  'LE','LES','MAC','MC','VAN','VON','Y',
];

function normalizarTexto(texto: string): string {
  return texto
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z]/g, '');
}

function eliminarPrefijos(palabras: string[]): string[] {
  return palabras.filter(p => !PREFIJOS.includes(p));
}

function primeraVocalInterna(palabra: string): string {
  const vocales = 'AEIOU';
  for (let i = 1; i < palabra.length; i++) {
    if (vocales.includes(palabra[i])) return palabra[i];
  }
  return 'X';
}

function primeraConsonanteInterna(palabra: string): string {
  const consonantes = 'BCDFGHJKLMNOPQRSTVWXYZ';
  for (let i = 1; i < palabra.length; i++) {
    if (consonantes.includes(palabra[i])) return palabra[i];
  }
  return 'X';
}

/**
 * Calculates the CURP prefix (first 11 characters):
 * - Pos 1: First letter of paternal surname
 * - Pos 2: First internal vowel of paternal surname
 * - Pos 3: First letter of maternal surname (or X if none)
 * - Pos 4: First letter of given name
 * - Pos 5-10: Date of birth YYMMDD
 * - Pos 11: Sex (H=masculino, M=femenino, X=no_binario)
 *
 * Returns empty string if insufficient data.
 */
export function calcularPrefijoCurp(
  nombre: string,
  apellidoPaterno: string,
  apellidoMaterno: string,
  fechaNacimiento: string,
  sexo: 'masculino' | 'femenino' | 'no_binario' | ''
): string {
  if (!nombre || !apellidoPaterno || !fechaNacimiento || !sexo) return '';

  const palabrasPaterno = eliminarPrefijos(
    apellidoPaterno.toUpperCase().trim().split(/\s+/)
  );
  const palabrasMaterno = apellidoMaterno
    ? eliminarPrefijos(apellidoMaterno.toUpperCase().trim().split(/\s+/))
    : [];
  const palabrasNombre = eliminarPrefijos(
    nombre.toUpperCase().trim().split(/\s+/)
  );

  if (!palabrasPaterno.length || !palabrasNombre.length) return '';

  const pPaterno = normalizarTexto(palabrasPaterno[0]);
  const pMaterno = palabrasMaterno.length > 0 ? normalizarTexto(palabrasMaterno[0]) : '';

  // Nombre: skip "MARIA" / "JOSE" if compound name
  let nombreBase = normalizarTexto(palabrasNombre[0]);
  if (
    palabrasNombre.length > 1 &&
    (palabrasNombre[0] === 'MARIA' || palabrasNombre[0] === 'JOSE' || palabrasNombre[0] === 'MA' || palabrasNombre[0] === 'J')
  ) {
    nombreBase = normalizarTexto(palabrasNombre[1]);
  }

  if (!pPaterno || !nombreBase) return '';

  const letra1 = pPaterno[0] || 'X';
  const letra2 = primeraVocalInterna(pPaterno);
  const letra3 = pMaterno ? pMaterno[0] : 'X';
  const letra4 = nombreBase[0] || 'X';

  let cuatroLetras = `${letra1}${letra2}${letra3}${letra4}`;

  // Replace inconvenient words
  if (PALABRAS_INCONVENIENTES.includes(cuatroLetras)) {
    cuatroLetras = cuatroLetras[0] + 'X' + cuatroLetras.slice(2);
  }

  // Date: fechaNacimiento is ISO format YYYY-MM-DD
  const partes = fechaNacimiento.split('-');
  if (partes.length !== 3) return cuatroLetras;
  const yy = partes[0].slice(2);
  const mm = partes[1];
  const dd = partes[2];
  const fecha = `${yy}${mm}${dd}`;

  const letraSexo = sexo === 'masculino' ? 'H' : sexo === 'femenino' ? 'M' : 'X';

  return `${cuatroLetras}${fecha}${letraSexo}`;
}
