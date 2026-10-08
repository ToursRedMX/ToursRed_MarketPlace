import type { ProveedorSms } from '../tipos.ts';
// No logging of message body or recipient, even in simulation.
export const mock: ProveedorSms = {
  nombre: 'mock',
  enviar: async m => m.simulacion
    ? { estado: 'simulado', idProveedor: m.correlacion }
    : { estado: 'fallido', clase: 'permanente', codigo: 'mock_solo_simulacion' },
};
