# Matriz UAT

- **Tablero vivo:** https://claude.ai/artifact/XxJmg8zg11akrX2GXVfTSq (privado; se comparte desde su menu Compartir).
  Ahi se marca el estado de cada caso. Los estados viven en la base de ese tablero, **no** en este repo ni en Supabase.
- **`matriz-uat.html`:** el codigo del tablero y la lista de los 140 casos. Abierto fuera de claude.ai muestra los casos pero no guarda estados.
- **`estado-YYYY-MM-DD.json`:** respaldo de los estados. Se exporta al cierre de cada jornada de UAT para que el avance quede en git.
  Formato: `casos` es un objeto `{ "<ID>": { status, owner, notes, by, at } }`; un caso sin entrada sigue pendiente con su responsable original.
- **Responsables:** `Claude` lo ejecuta solo; `Axel` solo el (login con TOTP u OTP, tarjetas, bandeja de entrada); `Ambos`: Axel hace la accion y Claude verifica en la base.
- **Prioridad:** P0 bloquea el lanzamiento, P1 importante, P2 menor.

Para republicar el tablero con casos nuevos se edita `matriz-uat.html` y se publica a la misma URL: los estados guardados no se pierden.
