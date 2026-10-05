-- Cola global interna de metadatos. tenant_id es una llave histórica, sin FK:
-- debe sobrevivir a la eliminación de la organización origen.
ALTER TABLE tenants ADD COLUMN platform_crm_attribution jsonb;
UPDATE tenants SET platform_crm_attribution = registration_intent - 'expiresAt' WHERE registration_intent IS NOT NULL;
CREATE TABLE platform_crm_events (
  tenant_id uuid PRIMARY KEY,
  generation uuid NOT NULL DEFAULT gen_random_uuid(),
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE platform_crm_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_crm_events FORCE ROW LEVEL SECURITY;
CREATE POLICY platform_crm_worker ON platform_crm_events FOR ALL
  USING (current_setting('app.platform_crm_worker', true) = 'on')
  WITH CHECK (current_setting('app.platform_crm_worker', true) = 'on');
--> statement-breakpoint
CREATE FUNCTION capture_platform_crm_attribution() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF NEW.registration_intent IS NOT NULL THEN
    NEW.platform_crm_attribution := jsonb_build_object(
      'plan', NEW.registration_intent->'plan', 'interval', NEW.registration_intent->'interval',
      'utm_source', NEW.registration_intent->'utm_source', 'utm_medium', NEW.registration_intent->'utm_medium',
      'utm_campaign', NEW.registration_intent->'utm_campaign', 'ref', NEW.registration_intent->'ref');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER platform_crm_attribution BEFORE INSERT OR UPDATE OF registration_intent ON tenants
  FOR EACH ROW EXECUTE FUNCTION capture_platform_crm_attribution();
--> statement-breakpoint
CREATE FUNCTION capture_platform_crm_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET app.platform_crm_worker = 'on' SET lock_timeout = '100ms' AS $$
DECLARE source_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'tenants' THEN
    source_id := NEW.id;
  ELSE
    IF TG_OP = 'DELETE' THEN source_id := OLD.tenant_id;
    ELSE source_id := NEW.tenant_id;
    END IF;
  END IF;
  -- Los DELETE en cascada de las suscripciones no sustituyen la lápida del tenant.
  INSERT INTO public.platform_crm_events (tenant_id) VALUES (source_id)
    ON CONFLICT (tenant_id) DO UPDATE SET generation = gen_random_uuid();
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  -- Solo la captura auxiliar falla: el cobro/registro/transacción principal continúa.
  RAISE WARNING 'platform_crm_event_capture_failed';
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION capture_platform_crm_event() FROM PUBLIC;
CREATE TRIGGER platform_crm_tenant_event AFTER INSERT OR UPDATE OF name, email, registration_intent, onboarding_status ON tenants
  FOR EACH ROW EXECUTE FUNCTION capture_platform_crm_event();
CREATE TRIGGER platform_crm_subscription_event AFTER INSERT OR UPDATE OR DELETE ON tenant_subscriptions
  FOR EACH ROW EXECUTE FUNCTION capture_platform_crm_event();
CREATE TRIGGER platform_crm_invoice_event AFTER INSERT OR UPDATE ON tenant_billing_invoices
  FOR EACH ROW EXECUTE FUNCTION capture_platform_crm_event();
CREATE TRIGGER platform_crm_override_event AFTER INSERT OR UPDATE OR DELETE ON tenant_limit_overrides
  FOR EACH ROW EXECUTE FUNCTION capture_platform_crm_event();
--> statement-breakpoint
-- Solo la baja necesita un contexto UUID de lectura; las altas/cobros no lo alteran.
CREATE FUNCTION capture_platform_crm_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET app.platform_crm_worker = 'on' SET lock_timeout = '100ms'
  SET app.tenant_id = '00000000-0000-0000-0000-000000000000' SET app.person_id = '00000000-0000-0000-0000-000000000000' AS $$
DECLARE owner_email text; data jsonb;
BEGIN
  PERFORM set_config('app.tenant_id', OLD.id::text, true);
  SELECT p.email INTO owner_email FROM public.users u JOIN public.people p ON p.id = u.person_id
    JOIN public.roles r ON r.id = u.role_id WHERE u.tenant_id = OLD.id AND r.is_system
    ORDER BY u.created_at LIMIT 1;
  data := jsonb_build_object('deleted', jsonb_build_object('nombre', OLD.name, 'correo', coalesce(owner_email, OLD.email),
    'fecha_alta', OLD.created_at, 'fecha_baja', now(), 'attribution', OLD.platform_crm_attribution));
  INSERT INTO public.platform_crm_events (tenant_id, payload) VALUES (OLD.id, data)
    ON CONFLICT (tenant_id) DO UPDATE SET generation = gen_random_uuid(), payload = EXCLUDED.payload;
  RETURN OLD;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'platform_crm_event_capture_failed';
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION capture_platform_crm_delete() FROM PUBLIC;
CREATE TRIGGER platform_crm_tenant_delete BEFORE DELETE ON tenants FOR EACH ROW EXECUTE FUNCTION capture_platform_crm_delete();
--> statement-breakpoint
CREATE FUNCTION capture_platform_crm_plan_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public SET app.platform_crm_worker = 'on' SET lock_timeout = '100ms' AS $$
BEGIN
  INSERT INTO public.platform_crm_events (tenant_id)
    SELECT id FROM public.tenants
    ON CONFLICT (tenant_id) DO UPDATE SET generation = gen_random_uuid();
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'platform_crm_event_capture_failed';
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION capture_platform_crm_plan_event() FROM PUBLIC;
CREATE TRIGGER platform_crm_plan_event AFTER UPDATE ON plans FOR EACH ROW EXECUTE FUNCTION capture_platform_crm_plan_event();
