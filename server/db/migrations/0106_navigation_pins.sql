CREATE TABLE navigation_pins (
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 item_key text NOT NULL CHECK(length(item_key) BETWEEN 1 AND 100),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,user_id,item_key)
);
ALTER TABLE navigation_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE navigation_pins FORCE ROW LEVEL SECURITY;
CREATE POLICY navigation_pins_scope ON navigation_pins
 USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND user_id=nullif(current_setting('app.nav_user_id',true),'')::uuid)
 WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND user_id=nullif(current_setting('app.nav_user_id',true),'')::uuid);
REVOKE ALL ON navigation_pins FROM PUBLIC;
GRANT SELECT,INSERT,DELETE ON navigation_pins TO erp_app;
