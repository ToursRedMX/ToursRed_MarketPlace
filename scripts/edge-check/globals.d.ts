// Declaracion ambiente de los globales que inyecta el runtime de Supabase Edge
// Functions y que el paquete de tipos oficial NO expone a sus consumidores.
//
// Verificado el 03-sep-2026: `jsr:@supabase/functions-js/edge-runtime.d.ts`
// declara `namespace EdgeRuntime`, pero ni importandolo ni con una referencia
// triple-slash queda visible el global (probado con una sonda minima). 164 de
// las 180 funciones cargan ese import y aun asi `deno check` reporta
// "Cannot find name 'EdgeRuntime'".
//
// Este archivo NO se despliega: vive fuera de supabase/functions/ y solo lo usa
// el chequeo de tipos.

declare namespace EdgeRuntime {
  function waitUntil<T>(promise: Promise<T>): void;
}
