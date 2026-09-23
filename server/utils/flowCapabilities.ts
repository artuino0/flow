import { and, eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { db, withTenant } from '~/server/db'
import { roleCapabilities, roleChatPermissions, roles, tenantApps, tenants, userCapabilityOverrides, userChatPermissionOverrides, users } from '~/server/db/schema'
import { resolveChatPermissions } from '~/server/utils/chatPermissions'
import { requireAuth } from '~/server/utils/rbac'
import { FLOW_APP_ACCESS_CAPABILITY, FLOW_CAPABILITY_KEYS, DEFAULT_FLOW_CAPABILITIES, type AvailableFlowApp, type FlowCapabilityKey, type FlowCapabilityOverrides, type FlowCapabilityValues, type ResolvedFlowCapabilities } from '~/utils/flowCapabilities'
import { FLOW_APP_KEYS } from '~/utils/flowApps'

export async function resolveFlowCapabilities(tenantId: string, userId: string): Promise<ResolvedFlowCapabilities | null> {
  const base = await withTenant(tenantId, async tx => {
    const [membership] = await tx.select({ roleId: users.roleId, active: users.isActive }).from(users)
      .where(and(eq(users.id, userId), eq(users.tenantId, tenantId))).limit(1)
    if (!membership?.active || !membership.roleId) return null
    const [role] = await tx.select({ id: roles.id, name: roles.name, isSystem: roles.isSystem }).from(roles)
      .where(and(eq(roles.id, membership.roleId), eq(roles.tenantId, tenantId))).limit(1)
    if (!role) return null
    const roleRows = await tx.select({ key: roleCapabilities.capabilityKey, allowed: roleCapabilities.allowed }).from(roleCapabilities)
      .where(and(eq(roleCapabilities.tenantId, tenantId), eq(roleCapabilities.roleId, role.id)))
    const overrideRows = await tx.select({ key: userCapabilityOverrides.capabilityKey, allowed: userCapabilityOverrides.allowed }).from(userCapabilityOverrides)
      .where(and(eq(userCapabilityOverrides.tenantId, tenantId), eq(userCapabilityOverrides.userId, userId)))
    return { role, roleRows, overrideRows }
  })
  if (!base) return null

  const chat = await resolveChatPermissions(tenantId, userId)
  const roleMap = new Map(base.roleRows.map(row => [row.key, row.allowed]))
  const overrideMap = new Map(base.overrideRows.map(row => [row.key, row.allowed]))
  const roleValues = Object.fromEntries(FLOW_CAPABILITY_KEYS.map((key) => {
    if (base.role.isSystem || key === 'core.access' || key === 'settings.access') return [key, true]
    if (roleMap.has(key)) return [key, Boolean(roleMap.get(key))]
    if (key === 'communications.access') return [key, chat?.role.canAccess ?? DEFAULT_FLOW_CAPABILITIES[key]]
    return [key, DEFAULT_FLOW_CAPABILITIES[key]]
  })) as FlowCapabilityValues
  const overrides = Object.fromEntries(FLOW_CAPABILITY_KEYS.map((key) => {
    if (key === 'core.access' || key === 'settings.access') return [key, null]
    if (overrideMap.has(key)) return [key, overrideMap.get(key) ?? null]
    if (key === 'communications.access') return [key, chat?.overrides.canAccess ?? null]
    return [key, null]
  })) as FlowCapabilityOverrides
  const effective = Object.fromEntries(FLOW_CAPABILITY_KEYS.map(key => [key, overrides[key] ?? roleValues[key]])) as FlowCapabilityValues
  const source = Object.fromEntries(FLOW_CAPABILITY_KEYS.map(key => [key, overrides[key] === null ? 'role' : 'user'])) as ResolvedFlowCapabilities['source']
  return { role: roleValues, overrides, effective, source, roleName: base.role.name, isSystemRole: base.role.isSystem }
}

export async function listAvailableFlowApps(tenantId: string, userId: string): Promise<{ apps: AvailableFlowApp[]; capabilities: ResolvedFlowCapabilities }> {
  const capabilities = await resolveFlowCapabilities(tenantId, userId)
  if (!capabilities) throw createError({ statusCode: 403, statusMessage: 'Usuario sin acceso a la organización' })
  const [configured, organization] = await Promise.all([
    withTenant(tenantId, tx => tx.select({ key: tenantApps.appKey, enabled: tenantApps.enabled }).from(tenantApps).where(eq(tenantApps.tenantId, tenantId))),
    db.select({ country: tenants.country }).from(tenants).where(eq(tenants.id, tenantId)).limit(1)
  ])
  const enabledByKey = new Map(configured.map(row => [row.key, row.enabled]))
  const country = organization[0]?.country ?? 'MX'
  const apps = FLOW_APP_KEYS.map((key): AvailableFlowApp => {
    const enabled = key === 'core' || key === 'settings' ? true : (enabledByKey.get(key) ?? true)
    const countryAllowed = key !== 'billing' || country === 'MX'
    return { key, enabled: enabled && countryAllowed, accessible: enabled && countryAllowed && capabilities.effective[FLOW_APP_ACCESS_CAPABILITY[key]] }
  })
  return { apps, capabilities }
}

export async function requireFlowCapability(event: H3Event, key: FlowCapabilityKey) {
  const auth = requireAuth(event)
  if (event.context.apiKeyId) throw createError({ statusCode: 403, statusMessage: 'Las API keys no pueden administrar aplicaciones de Flow' })
  const permissions = await resolveFlowCapabilities(auth.tenantId, auth.sub)
  if (!permissions?.effective[key]) throw createError({ statusCode: 403, statusMessage: 'No tienes permiso para acceder a esta aplicación' })
  return { auth, permissions }
}

export async function getRoleFlowCapabilities(tenantId: string, roleId: string) {
  return withTenant(tenantId, async tx => {
    const [role] = await tx.select({ id: roles.id, name: roles.name, isSystem: roles.isSystem }).from(roles)
      .where(and(eq(roles.id, roleId), eq(roles.tenantId, tenantId))).limit(1)
    if (!role) return null
    const rows = await tx.select({ key: roleCapabilities.capabilityKey, allowed: roleCapabilities.allowed }).from(roleCapabilities)
      .where(and(eq(roleCapabilities.tenantId, tenantId), eq(roleCapabilities.roleId, roleId)))
    const configured = new Map(rows.map(row => [row.key, row.allowed]))
    const permissions = Object.fromEntries(FLOW_CAPABILITY_KEYS.map(key => [
      key,
      role.isSystem || key === 'core.access' || key === 'settings.access'
        ? true
        : (configured.get(key) ?? DEFAULT_FLOW_CAPABILITIES[key])
    ])) as FlowCapabilityValues
    return { role, permissions }
  })
}

export async function setRoleFlowCapabilities(tenantId: string, roleId: string, values: FlowCapabilityValues) {
  return withTenant(tenantId, async tx => {
    const [role] = await tx.select({ id: roles.id, name: roles.name, isSystem: roles.isSystem }).from(roles)
      .where(and(eq(roles.id, roleId), eq(roles.tenantId, tenantId))).limit(1)
    if (!role) return null
    const next = Object.fromEntries(FLOW_CAPABILITY_KEYS.map(key => [
      key,
      role.isSystem || key === 'core.access' || key === 'settings.access' ? true : values[key]
    ])) as FlowCapabilityValues
    for (const key of FLOW_CAPABILITY_KEYS) {
      await tx.insert(roleCapabilities).values({ tenantId, roleId, capabilityKey: key, allowed: next[key] }).onConflictDoUpdate({
        target: [roleCapabilities.roleId, roleCapabilities.capabilityKey],
        set: { allowed: next[key], updatedAt: new Date() }
      })
    }
    await tx.insert(roleChatPermissions).values({
      tenantId,
      roleId,
      canAccess: next['communications.access'],
      canStartDirect: true,
      canSendAttachments: true,
      canCreateGroups: false
    }).onConflictDoUpdate({
      target: roleChatPermissions.roleId,
      set: { canAccess: next['communications.access'], updatedAt: new Date() }
    })
    return { role, permissions: next }
  })
}

export async function setUserFlowCapabilityOverrides(tenantId: string, userId: string, values: FlowCapabilityOverrides) {
  await withTenant(tenantId, async tx => {
    const [target] = await tx.select({ id: users.id }).from(users)
      .where(and(eq(users.id, userId), eq(users.tenantId, tenantId))).limit(1)
    if (!target) throw createError({ statusCode: 404, statusMessage: 'Usuario no encontrado' })
    const next: FlowCapabilityOverrides = { ...values, 'core.access': null, 'settings.access': null }
    for (const key of FLOW_CAPABILITY_KEYS) {
      await tx.insert(userCapabilityOverrides).values({ tenantId, userId, capabilityKey: key, allowed: next[key] }).onConflictDoUpdate({
        target: [userCapabilityOverrides.userId, userCapabilityOverrides.capabilityKey],
        set: { allowed: next[key], updatedAt: new Date() }
      })
    }
    await tx.insert(userChatPermissionOverrides).values({ tenantId, userId, canAccess: next['communications.access'] }).onConflictDoUpdate({
      target: userChatPermissionOverrides.userId,
      set: { canAccess: next['communications.access'], updatedAt: new Date() }
    })
  })
  return resolveFlowCapabilities(tenantId, userId)
}
