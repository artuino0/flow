import 'dotenv/config'
import postgres from 'postgres'
import jwt from 'jsonwebtoken'
import assert from 'node:assert/strict'
const db = postgres(process.env.DATABASE_URL, { max: 1 })
const base = process.env.TEST_BASE_URL || 'http://localhost:3001'
const sessionIds = []
const keyIds = []
let original
let admin
let temporaryPerson
let temporaryRole
async function sessionFor(row) {
  const [session] = await db`INSERT INTO auth_sessions (tenant_id,user_id,user_agent,expires_at) VALUES (${row.tenant_id},${row.id},'Settings verification',now()+interval '1 hour') RETURNING id`
  sessionIds.push(session.id)
  const payload = { sub: row.id, tenantId: row.tenant_id, roleId: row.role_id, sid: session.id }
  return { ...payload, token: jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '10m' }) }
}
async function request(path, auth, method = 'GET', body) {
  const response = await fetch(base + path, { method, headers: { Authorization: 'Bearer ' + auth.token, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
  const data = await response.json()
  return { status: response.status, data }
}
try {
  const [row] = await db`SELECT u.id,u.tenant_id,u.role_id FROM users u JOIN people p ON p.id=u.person_id JOIN roles r ON r.id=u.role_id WHERE p.email='arturosistemas94@gmail.com' AND r.is_system=true AND u.is_active=true LIMIT 1`
  assert.ok(row, 'Cuenta de demostración administradora disponible')
  admin = await sessionFor(row)
  const result = await request('/api/tenant', admin)
  assert.equal(result.status, 200)
  original = result.data
  let changed = await request('/api/tenant', admin, 'PUT', { idleTimeoutMinutes: 45, idleWarningMinutes: 2 })
  assert.equal(changed.status, 200)
  assert.equal((await request('/api/auth/me', admin)).data.idleTimeoutMinutes, 45)
  changed = await request('/api/tenant', admin, 'PUT', { idleTimeoutMinutes: 5, idleWarningMinutes: 5 })
  assert.ok(changed.status >= 400, 'Debe rechazar aviso igual al cierre')
  changed = await request('/api/tenant', admin, 'PUT', { timezone: 'Zona/Inventada' })
  assert.ok(changed.status >= 400, 'Debe rechazar zonas inválidas')
  const list = await request('/api/auth/sessions', admin)
  assert.ok(list.data.some(s => s.id === admin.sid && s.current))
  const second = await sessionFor(row)
  assert.equal((await request('/api/auth/sessions/' + second.sid, admin, 'DELETE')).status, 200)
  assert.equal((await request('/api/auth/me', second)).status, 401)
  const refreshToken = jwt.sign({ sub: second.sub, tenantId: second.tenantId, sid: second.sid, purpose: 'refresh' }, process.env.JWT_SECRET, { expiresIn: '1h' })
  assert.equal((await fetch(base + '/api/auth/refresh', { method: 'POST', headers: { cookie: 'erp_refresh_token=' + refreshToken } })).status, 401)
  assert.equal((await request('/api/tenant', { token: refreshToken })).status, 401)
  const expired = await sessionFor(row)
  await db`UPDATE auth_sessions SET last_seen_at = now()-interval '2 days' WHERE id=${expired.sid}`
  assert.equal((await request('/api/auth/me', expired)).status, 401)
  const available = await request('/api/settings/api-keys/entities', admin)
  assert.equal(available.status, 200)
  const readable = available.data.entities.find(e => e.read)
  if (readable) {
    const key = await request('/api/settings/api-keys', admin, 'POST', { name: 'Settings verification temporary', scopes: { [readable.slug]: { read: true } } })
    assert.equal(key.status, 200)
    keyIds.push(key.data.id)
    assert.equal((await request('/api/settings/api-keys', { token: key.data.token })).status, 403)
    assert.equal((await request('/api/auth/profile', { token: key.data.token }, 'PUT', { fullName: 'Forbidden' })).status, 403)
    const own = await request('/api/settings/api-keys?mine=true', admin)
    assert.ok(own.data.every(k => k.ownerUserId === admin.sub))
    assert.ok(own.data.every(k => !k.token && !k.tokenHash))
    assert.equal((await request('/api/settings/api-keys/' + key.data.id, admin, 'DELETE')).status, 200)
  }
  let [regular] = await db`SELECT u.id,u.tenant_id,u.role_id FROM users u JOIN roles r ON r.id=u.role_id WHERE r.is_system=false AND u.is_active=true LIMIT 1`
  if (!regular) {
    const [role] = await db`INSERT INTO roles (tenant_id,name,is_system) VALUES (${row.tenant_id},'Settings verification temporary',false) RETURNING id`
    temporaryRole = role.id
    const [person] = await db`INSERT INTO people (email,full_name,password_hash) VALUES ('settings-test-' || gen_random_uuid() || '@example.invalid','Settings verification','!disabled') RETURNING id`
    temporaryPerson = person.id
    ;[regular] = await db`INSERT INTO users (tenant_id,person_id,role_id) VALUES (${row.tenant_id},${person.id},${role.id}) RETURNING id,tenant_id,role_id`
  }
  const normal = await sessionFor(regular)
  assert.equal((await request('/api/tenant', normal)).status, 403)
  assert.equal((await request('/api/settings/email', normal)).status, 403)
  assert.equal((await request('/api/auth/sessions', normal)).status, 200)
  assert.equal((await request('/api/settings/api-keys/entities', normal)).status, 200)
  const personal = await request('/api/settings/api-keys', normal)
  assert.equal(personal.status, 200)
  assert.ok(personal.data.every(k => k.ownerUserId === normal.sub))
  console.log('OK: guardado, validación, política de sesión, revocación de acceso y refresh, expiración, API keys y permisos de usuario normal.')
} finally {
  if (original && admin) await db`UPDATE tenants SET idle_timeout_minutes=${original.idleTimeoutMinutes},idle_warning_minutes=${original.idleWarningMinutes} WHERE id=${admin.tenantId}`
  for (const id of keyIds) await db`DELETE FROM api_keys WHERE id=${id}`
  for (const id of sessionIds) await db`DELETE FROM auth_sessions WHERE id=${id}`
  if (temporaryPerson) await db`DELETE FROM people WHERE id=${temporaryPerson}`
  if (temporaryRole) await db`DELETE FROM roles WHERE id=${temporaryRole}`
  await db.end()
}
