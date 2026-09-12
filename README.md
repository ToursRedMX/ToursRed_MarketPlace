# ToursRed

Plataforma de marketplace para tours y experiencias de viaje.

## Requisitos del build

El proyecto usa [write-excel-file](https://github.com/catamphetamine/write-excel-file) para generar archivos .xlsx en el navegador y en las Supabase Edge Functions. La versión está fijada en 4.1.1 en package.json y en los imports Deno para que el frontend y Edge compartan la misma implementación.

La librería se usa únicamente para **escribir** hojas de cálculo. El proyecto no acepta ni parsea archivos .xlsx subidos por usuarios.

---

Contexto completo de la migración en `docs/auditorias/2026-09-05-auditoria-frontend.md`, hallazgo **F-5**.
