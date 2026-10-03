CREATE TABLE agenda_settings (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id),
 slot_minutes integer NOT NULL DEFAULT 30 CHECK (slot_minutes BETWEEN 5 AND 120),
 buffer_minutes integer NOT NULL DEFAULT 0 CHECK (buffer_minutes BETWEEN 0 AND 120),
 min_notice_minutes integer NOT NULL DEFAULT 0 CHECK (min_notice_minutes BETWEEN 0 AND 525600),
 max_days_ahead integer NOT NULL DEFAULT 30 CHECK (max_days_ahead BETWEEN 1 AND 365),
 assignment_mode text NOT NULL DEFAULT 'both' CHECK (assignment_mode IN ('client_chooses','auto','both')),
 conflict_policy text NOT NULL DEFAULT 'block' CHECK (conflict_policy IN ('block','warn')),
 confirmation_message text NOT NULL DEFAULT 'Tu cita quedó agendada.' CHECK (length(confirmation_message) <= 2000)
);
CREATE TABLE agenda_schedules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
 user_id uuid NOT NULL REFERENCES users(id), weekday integer NOT NULL CHECK (weekday BETWEEN 0 AND 6),
 start_time time NOT NULL, end_time time NOT NULL CHECK (end_time > start_time),
 valid_from date, valid_to date, CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_from <= valid_to)
);
CREATE INDEX agenda_schedules_person_idx ON agenda_schedules(tenant_id,user_id,weekday);
CREATE TABLE agenda_time_off (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
 user_id uuid REFERENCES users(id), start_local timestamp NOT NULL, end_local timestamp NOT NULL CHECK (end_local > start_local),
 reason text NOT NULL CHECK (length(reason) BETWEEN 1 AND 500), all_day boolean NOT NULL DEFAULT false,
 CHECK (NOT all_day OR (start_local::time = '00:00' AND end_local::time = '00:00'))
);
CREATE INDEX agenda_time_off_range_idx ON agenda_time_off(tenant_id,user_id,start_local,end_local);
ALTER TABLE agenda_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenda_settings FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_agenda_settings ON agenda_settings USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid);
ALTER TABLE agenda_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenda_schedules FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_agenda_schedules ON agenda_schedules USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS (SELECT 1 FROM users u WHERE u.id=user_id AND u.tenant_id=agenda_schedules.tenant_id));
ALTER TABLE agenda_time_off ENABLE ROW LEVEL SECURITY;
ALTER TABLE agenda_time_off FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_agenda_time_off ON agenda_time_off USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid AND (user_id IS NULL OR EXISTS (SELECT 1 FROM users u WHERE u.id=user_id AND u.tenant_id=agenda_time_off.tenant_id)));

-- Candado común con reserveSlot. Orden de fechas estable; cubre medianoche y buffer.
CREATE FUNCTION agenda_lock_slot(tid uuid, uid uuid, start_at timestamp, end_at timestamp) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path=public,pg_temp AS $$
DECLARE day_key date;
BEGIN
 IF tid IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid THEN RAISE EXCEPTION 'Organización inválida'; END IF;
 PERFORM pg_advisory_xact_lock_shared(hashtextextended(tid::text,175));
 FOR day_key IN SELECT generate_series(start_at::date,end_at::date,'1 day')::date LOOP
  PERFORM pg_advisory_xact_lock(hashtextextended(tid::text || ':' || uid::text || ':' || day_key::text,175));
 END LOOP;
END $$;

-- Lectura acotada de ocupación: no devuelve clientes ni notas y no aplica RLS
-- de propietario (la disponibilidad debe ver también las citas ajenas).
CREATE FUNCTION agenda_occupancy(tid uuid) RETURNS TABLE(user_id text, fecha text, hora text, duration integer, estado text)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT r.custom_data->>'personal',r.custom_data->>'fecha',r.custom_data->>'hora',
 CASE WHEN r.custom_data->>'duracion_minutos' ~ '^[0-9]+$' THEN (r.custom_data->>'duracion_minutos')::integer ELSE 30 END,
 coalesce(r.custom_data->>'estado','agendada')
 FROM records r JOIN entities e ON e.id=r.entity_id AND e.tenant_id=r.tenant_id
 WHERE tid = nullif(current_setting('app.tenant_id',true),'')::uuid AND r.tenant_id=tid AND r.deleted_at IS NULL
 AND e.slug='agenda-citas' AND e.template_key='agenda'
 AND r.custom_data->>'fecha' ~ '^\d{4}-\d{2}-\d{2}$' AND r.custom_data->>'hora' ~ '^([01]\d|2[0-3]):[0-5]\d$'
$$;
REVOKE ALL ON FUNCTION agenda_occupancy(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agenda_occupancy(uuid) TO erp_app;

-- Misma conversión que Intl: mínimo instante válido para la hora local.
-- Sirve también para cambios de 30 minutos (Australia/Lord_Howe).
CREATE FUNCTION agenda_local_instant(wall timestamp, zone text) RETURNS timestamptz
LANGUAGE plpgsql STABLE SET search_path=public,pg_temp AS $$
DECLARE probe timestamptz; candidate timestamptz; result timestamptz; hours integer;
BEGIN
 FOREACH hours IN ARRAY ARRAY[-36,-12,0,12,36] LOOP
  probe := (wall AT TIME ZONE 'UTC') + make_interval(hours=>hours);
  candidate := probe + (wall - (probe AT TIME ZONE zone));
  IF candidate AT TIME ZONE zone = wall AND (result IS NULL OR candidate < result) THEN result := candidate; END IF;
 END LOOP;
 RETURN result;
END $$;

CREATE FUNCTION agenda_guard_record() RETURNS trigger LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE uid uuid; local_start timestamp; local_end timestamp; zone text; start_at timestamptz; end_at timestamptz;
 margin integer; policy text; force_reason text; conflicts integer;
BEGIN
 IF EXISTS(SELECT 1 FROM entities WHERE id=NEW.entity_id AND tenant_id=NEW.tenant_id AND slug='agenda-citas' AND template_key='agenda') THEN
  NEW.custom_data := NEW.custom_data - '_agenda_conflict';
 END IF;
 IF NEW.deleted_at IS NOT NULL OR coalesce(NEW.custom_data->>'estado','agendada') IN ('cancelada','no_asistio')
 OR NOT EXISTS(SELECT 1 FROM entities WHERE id=NEW.entity_id AND tenant_id=NEW.tenant_id AND slug='agenda-citas' AND template_key='agenda') THEN RETURN NEW; END IF;
 -- Registros históricos incompletos siguen editables; la API valida campos obligatorios.
 IF NEW.custom_data->>'personal' IS NULL OR NEW.custom_data->>'fecha' IS NULL OR NEW.custom_data->>'hora' IS NULL THEN RETURN NEW; END IF;
 uid := (NEW.custom_data->>'personal')::uuid;
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=uid AND tenant_id=NEW.tenant_id AND is_active) THEN RAISE EXCEPTION 'Personal inválido para esta organización' USING ERRCODE='23514'; END IF;
 IF NEW.custom_data->>'hora' !~ '^([01]\d|2[0-3]):[0-5]\d$' THEN RAISE EXCEPTION 'Hora inválida, usa HH:MM' USING ERRCODE='23514'; END IF;
 local_start := ((NEW.custom_data->>'fecha') || ' ' || (NEW.custom_data->>'hora'))::timestamp;
 local_end := local_start + make_interval(mins => coalesce((NEW.custom_data->>'duracion_minutos')::integer,30));
 IF local_end <= local_start OR local_end > local_start + interval '1 day' THEN RAISE EXCEPTION 'Duración inválida' USING ERRCODE='23514'; END IF;
 SELECT timezone INTO zone FROM tenants WHERE id=NEW.tenant_id;
 PERFORM pg_advisory_xact_lock_shared(hashtextextended(NEW.tenant_id::text,175));
 SELECT buffer_minutes,conflict_policy INTO margin,policy FROM agenda_settings WHERE tenant_id=NEW.tenant_id;
 margin := coalesce(margin,0); policy := coalesce(policy,'block');
 start_at := agenda_local_instant(local_start,zone);
 IF start_at IS NULL THEN RAISE EXCEPTION 'La hora no existe en esta zona horaria' USING ERRCODE='23514'; END IF;
 end_at := start_at + (local_end-local_start);
 PERFORM agenda_lock_slot(NEW.tenant_id,uid,(start_at-make_interval(mins=>margin)) AT TIME ZONE zone,(end_at+make_interval(mins=>margin)) AT TIME ZONE zone);
 SELECT count(*) INTO conflicts FROM records r
 WHERE r.tenant_id=NEW.tenant_id AND r.entity_id=NEW.entity_id AND r.id<>NEW.id AND r.deleted_at IS NULL
 AND r.custom_data->>'personal'=uid::text AND coalesce(r.custom_data->>'estado','agendada') NOT IN ('cancelada','no_asistio')
 AND r.custom_data->>'fecha' IS NOT NULL AND r.custom_data->>'hora' ~ '^([01]\d|2[0-3]):[0-5]\d$'
 AND agenda_local_instant(((r.custom_data->>'fecha') || ' ' || (r.custom_data->>'hora'))::timestamp,zone) < end_at + make_interval(mins=>margin)
 AND agenda_local_instant(((r.custom_data->>'fecha') || ' ' || (r.custom_data->>'hora'))::timestamp,zone)
  + make_interval(mins=>coalesce((r.custom_data->>'duracion_minutos')::integer,30)+margin) > start_at;
 IF conflicts > 0 THEN
  force_reason := nullif(current_setting('app.agenda_force_reason',true),'');
  IF policy='block' AND (force_reason IS NULL OR NOT EXISTS (
   SELECT 1 FROM users u JOIN roles ro ON ro.id=u.role_id AND ro.tenant_id=u.tenant_id
   WHERE u.id=nullif(current_setting('app.user_id',true),'')::uuid AND u.tenant_id=NEW.tenant_id AND u.is_active AND ro.is_system
  )) THEN RAISE EXCEPTION 'Hueco ya ocupado: el personal tiene una cita que se traslapa' USING ERRCODE='23P01'; END IF;
  NEW.custom_data := NEW.custom_data || jsonb_build_object('_agenda_conflict',jsonb_build_object('policy',policy,'reason',force_reason,'actor',nullif(current_setting('app.user_id',true),''),'at',clock_timestamp(),'count',conflicts));
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION agenda_guard_record() FROM PUBLIC;
CREATE TRIGGER agenda_no_double_booking BEFORE INSERT OR UPDATE OF custom_data,deleted_at ON records FOR EACH ROW EXECUTE FUNCTION agenda_guard_record();

CREATE FUNCTION agenda_conflict_activity() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.custom_data ? '_agenda_conflict' AND (TG_OP='INSERT' OR NEW.custom_data->'_agenda_conflict' IS DISTINCT FROM OLD.custom_data->'_agenda_conflict') THEN
  INSERT INTO record_activities(tenant_id,record_id,user_id,action_type,details)
  VALUES(NEW.tenant_id,NEW.id,nullif(nullif(current_setting('app.user_id',true),''),'00000000-0000-0000-0000-000000000000')::uuid,'AGENDA_CONFLICT',
   (NEW.custom_data->'_agenda_conflict') || jsonb_build_object('text', 'Cita traslapada. ' || coalesce(NEW.custom_data->'_agenda_conflict'->>'reason','Aviso permitido en Ajustes de agenda.')));
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION agenda_conflict_activity() FROM PUBLIC;
CREATE TRIGGER agenda_conflict_log AFTER INSERT OR UPDATE OF custom_data ON records FOR EACH ROW EXECUTE FUNCTION agenda_conflict_activity();

CREATE FUNCTION agenda_validate_schedule() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.tenant_id::text,175));
 IF EXISTS(SELECT 1 FROM agenda_schedules s WHERE s.tenant_id=NEW.tenant_id AND s.user_id=NEW.user_id AND s.weekday=NEW.weekday AND s.id<>NEW.id
  AND s.start_time<NEW.end_time AND s.end_time>NEW.start_time
  AND coalesce(s.valid_from,'0001-01-01'::date)<=coalesce(NEW.valid_to,'9999-12-31'::date)
  AND coalesce(NEW.valid_from,'0001-01-01'::date)<=coalesce(s.valid_to,'9999-12-31'::date))
 THEN RAISE EXCEPTION 'Los rangos del mismo día no pueden traslaparse' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER agenda_schedule_ranges BEFORE INSERT OR UPDATE ON agenda_schedules FOR EACH ROW EXECUTE FUNCTION agenda_validate_schedule();
