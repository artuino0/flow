# Buscador global

Se abre desde el encabezado o con Control/Command + K. Flechas para seleccionar, Enter para abrir y Escape para cerrar. Busca desde dos caracteres, agrupa registros por módulo y ofrece comandos para abrir módulos, crear registros y abrir reportes cuando corresponde.

GET /api/search acepta q (hasta 100 caracteres), recent (hasta ocho UUID separados por comas) y entity (slug opcional). Devuelve resultados acotados a cinco por módulo y treinta en total, comandos y hasMore. No incluye registros eliminados ni módulos inactivos. Requiere permiso de lectura, respeta la empresa y restringe también los scopes de API keys. Las relaciones directas se buscan solo cuando ambos módulos son legibles. El acceso al registro se vuelve a validar en su ruta normal.

El índice GIN de trigramas usa una expresión sobre los valores JSONB, sin incluir nombres de claves. PostgreSQL lo mantiene automáticamente en altas, cambios, importaciones y eliminaciones; no requiere sincronización de una copia de los datos. Normaliza mayúsculas y acentos españoles. El planificador elige índice o recorrido según costos y volumen. Las consultas tienen un límite de tres segundos. No se ha realizado una prueba de carga de producción.

Recientes e historial se guardan en el navegador, separados por empresa y usuario. Solo se persisten UUID de registros y términos buscados; los títulos se consultan nuevamente en el servidor con los permisos vigentes. Se pueden borrar desde el panel. El historial no se sincroniza entre dispositivos.

Aplicar 0044_global_search.sql mediante las migraciones del proyecto. Para una instalación local donde las anteriores ya se aplicaron manualmente: node scripts/apply-search-migration.mjs. Verificaciones: node scripts/check-global-search.mjs y vitest run test/unit/globalSearch.test.ts. El smoke test solo admite localhost, usa credenciales locales en memoria y no modifica registros.
