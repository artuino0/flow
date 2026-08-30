-- RLS sobre las dimensiones/hechos tenant-scoped del dominio OLAP (HU-ERD-27),
-- mismo patron que HU-ERD-12/HU-ERD-14. dim_date queda fuera a proposito: es
-- una tabla global (sin tenant_id), no aplica.

ALTER TABLE dim_cliente ENABLE ROW LEVEL SECURITY;
ALTER TABLE dim_cliente FORCE ROW LEVEL SECURITY;
ALTER TABLE dim_sucursal ENABLE ROW LEVEL SECURITY;
ALTER TABLE dim_sucursal FORCE ROW LEVEL SECURITY;
ALTER TABLE fact_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE fact_eventos FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_dim_cliente ON dim_cliente;
CREATE POLICY tenant_isolation_dim_cliente ON dim_cliente
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_dim_sucursal ON dim_sucursal;
CREATE POLICY tenant_isolation_dim_sucursal ON dim_sucursal
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);

DROP POLICY IF EXISTS tenant_isolation_fact_eventos ON fact_eventos;
CREATE POLICY tenant_isolation_fact_eventos ON fact_eventos
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
