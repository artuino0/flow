-- HU multi-organizacion (2026-09-04), fix: la resolucion de identidad en el
-- login (listActiveMembershipsForPerson/findActiveMembership,
-- server/utils/peopleAuth.ts) es por definicion una consulta CROSS-TENANT -
-- busca las membresias de una persona en CUALQUIER tenant, antes de que se
-- sepa cual es "el" tenant. La policy tenant_isolation_users (migracion
-- 0010) exige current_setting('app.tenant_id', true)::uuid = tenant_id, y
-- con FORCE ROW LEVEL SECURITY ni siquiera el dueño de la tabla escapa de
-- eso - sin ningun app.tenant_id seteado esa consulta SIEMPRE devuelve 0
-- filas (current_setting(...) es NULL, NULL::uuid = tenant_id nunca es
-- true), o peor, en una conexion pooled que YA seteo ese GUC antes en otra
-- transaccion, lo deja en '' (string vacio) al cerrar esa transaccion en vez
-- de volver a NULL - un hallazgo real de Postgres, documentado en
-- test/integration/rlsTenantIsolation.test.ts - y entonces la consulta
-- directamente lanza "invalid input syntax for type uuid: ''''". Ninguno de
-- los dos casos ve jamas una membresia real, sin importar cuantas existan.
--
-- Fix: una SEGUNDA policy PERMISSIVE de solo SELECT. Postgres combina varias
-- policies permissive del mismo comando con OR - esta no reemplaza ni
-- afloja tenant_isolation_users (que sigue rigiendo INSERT/UPDATE/DELETE y
-- el resto de los SELECT con tenant conocido), solo agrega una excepcion
-- angosta: "una persona siempre puede ver SUS PROPIAS membresias (en
-- cualquier tenant), si la conexion declaro explicitamente quien es
-- (app.person_id, via withPerson() en server/db/index.ts)". No requiere
-- BYPASSRLS ni un rol especial - erp_app sigue sin poder ver membresias de
-- otras personas, y esta policy es SOLO de lectura (no amplia INSERT/UPDATE/DELETE).
CREATE POLICY self_membership_lookup_users ON users
  FOR SELECT
  USING (person_id = current_setting('app.person_id', true)::uuid);
