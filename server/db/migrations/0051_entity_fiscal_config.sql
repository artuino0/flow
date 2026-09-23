-- Configuración explícita de integración fiscal por módulo. No crea módulos
-- duplicados: solo guarda el mapeo de los campos existentes del módulo.
ALTER TABLE entities ADD COLUMN IF NOT EXISTS fiscal_config jsonb;
COMMENT ON COLUMN entities.fiscal_config IS 'Mapeo opcional de campos del módulo para receptor/proveedor fiscal';
