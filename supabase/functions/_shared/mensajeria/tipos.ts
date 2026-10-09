export type Proveedor = 'labsmobile' | 'twilio' | 'mock';
export type CanalOtp = 'sms' | 'whatsapp';
export type Categoria = 'otp' | 'reserva_confirmada' | 'recordatorio_tour';
export type EstadoEntrega = 'aceptado' | 'enviado' | 'entregado' | 'fallido' | 'resultado_desconocido' | 'simulado';
export type ResultadoEnvio =
  | { estado: 'aceptado'; idProveedor: string }
  | { estado: 'simulado'; idProveedor: string }
  | { estado: 'fallido'; clase: 'permanente' | 'rechazo_confirmado'; codigo: string }
  | { estado: 'resultado_desconocido'; codigo: string };
export interface MensajeSms {
  canal?: CanalOtp;
  codigoOtp?: string;
  destino: string;
  texto: string;
  correlacion: string;
  categoria: Categoria;
  simulacion: boolean;
  urlEstados: string;
}
export interface ProveedorSms {
  nombre: Proveedor;
  enviar(mensaje: MensajeSms): Promise<ResultadoEnvio>;
  saldo?(): Promise<{ creditos: number } | null>;
}
export interface EventoEntrega {
  correlacion: string;
  destino: string;
  estado: EstadoEntrega;
  codigo: string;
  timestamp: string | null;
}
export interface RoutingSettings {
  whatsapp_habilitado?: boolean;
  whatsapp_proveedor_otp?: Proveedor;
  whatsapp_proveedor_respaldo?: Proveedor | null;
  whatsapp_fallback_habilitado?: boolean;
  sms_habilitado: boolean;
  sms_modo_prueba: boolean;
  sms_proveedor_otp: Proveedor;
  sms_proveedor_transaccional: Proveedor;
  sms_proveedor_recordatorios: Proveedor;
  sms_proveedor_respaldo: Proveedor | null;
  sms_fallback_habilitado: boolean;
}
