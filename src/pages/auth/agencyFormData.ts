export interface AgencyFormData {
  firstName: string;
  apellidoPaterno: string;
  apellidoMaterno: string;
  dateOfBirth: string;
  sexo: '' | 'masculino' | 'femenino' | 'no_binario';
  curp: string;
  email: string;
  password: string;
  confirmPassword: string;
  agencyName: string;
  phoneNumber: string;
  website: string;
  personaType: '' | 'persona_fisica' | 'persona_moral';
  representanteLegalNombre: string;
  rfc: string;
  razonSocial: string;
  rnt: string;
  regimenFiscal: string;
  banco: string;
  cuentaClabe: string;
  titularCuenta: string;
  street: string;
  exteriorNumber: string;
  interiorNumber: string;
  colony: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export const defaultAgencyFormData: AgencyFormData = {
  firstName: '',
  apellidoPaterno: '',
  apellidoMaterno: '',
  dateOfBirth: '',
  sexo: '',
  curp: '',
  email: '',
  password: '',
  confirmPassword: '',
  agencyName: '',
  phoneNumber: '',
  website: '',
  personaType: '',
  representanteLegalNombre: '',
  rfc: '',
  razonSocial: '',
  rnt: '',
  regimenFiscal: '',
  banco: '',
  cuentaClabe: '',
  titularCuenta: '',
  street: '',
  exteriorNumber: '',
  interiorNumber: '',
  colony: '',
  city: '',
  state: '',
  postalCode: '',
  country: 'México',
};
