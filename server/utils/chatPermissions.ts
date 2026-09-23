import { and, eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { withTenant } from '~/server/db'
import { roleCapabilities, roleChatPermissions, roles, userCapabilityOverrides, userChatPermissionOverrides, users } from '~/server/db/schema'
import { requireAuth } from '~/server/utils/rbac'
import { CHAT_PERMISSION_KEYS, type ChatPermissionKey, type ChatPermissionValues, type ResolvedChatPermissions } from '~/utils/chat'

const DEFAULT_ROLE_PERMISSIONS: ChatPermissionValues = {
  canAccess: true,
  canStartDirect: true,
  canSendAttachments: true,
  canCreateGroups: false
}

export async function resolveChatPermissions(tenantId: string, userId: string): Promise<ResolvedChatPermissions | null> {
  return withTenant(tenantId, async tx => {
    const [membership] = await tx.select({ roleId: users.roleId, active: users.isActive }).from(users)
      .where(and(eq(users.id, userId), eq(users.tenantId, tenantId))).limit(1)
    if (!membership?.active || !membership.roleId) return null

    const [role] = await tx.select({ id: roles.id, name: roles.name, isSystem: roles.isSystem }).from(roles)
      .where(and(eq(roles.id, membership.roleId), eq(roles.tenantId, tenantId))).limit(1)
    if (!role) return null
    const [roleRow] = await tx.select().from(roleChatPermissions).where(and(eq(roleChatPermissions.roleId, role.id), eq(roleChatPermissions.tenantId, tenantId))).limit(1)
    const [overrideRow] = await tx.select().from(userChatPermissionOverrides).where(and(eq(userChatPermissionOverrides.userId, userId), eq(userChatPermissionOverrides.tenantId, tenantId))).limit(1)
    const roleValues: ChatPermissionValues = role.isSystem
      ? { canAccess: true, canStartDirect: true, canSendAttachments: true, canCreateGroups: true }
      : {
          canAccess: roleRow?.canAccess ?? DEFAULT_ROLE_PERMISSIONS.canAccess,
          canStartDirect: roleRow?.canStartDirect ?? DEFAULT_ROLE_PERMISSIONS.canStartDirect,
          canSendAttachments: roleRow?.canSendAttachments ?? DEFAULT_ROLE_PERMISSIONS.canSendAttachments,
          canCreateGroups: roleRow?.canCreateGroups ?? DEFAULT_ROLE_PERMISSIONS.canCreateGroups
        }
    const overrides = Object.fromEntries(CHAT_PERMISSION_KEYS.map(key => [key, overrideRow?.[key] ?? null])) as ResolvedChatPermissions['overrides']
    const effective = Object.fromEntries(CHAT_PERMISSION_KEYS.map(key => [key, overrides[key] ?? roleValues[key]])) as unknown as ChatPermissionValues
    const source = Object.fromEntries(CHAT_PERMISSION_KEYS.map(key => [key, overrides[key] === null ? 'role' : 'user'])) as ResolvedChatPermissions['source']
    if (!effective.canAccess) {
      effective.canStartDirect = false
      effective.canSendAttachments = false
      effective.canCreateGroups = false
    }
    return { role: roleValues, overrides, effective, source, roleName: role.name }
  })
}

export async function requireChatPermission(event: H3Event, key: ChatPermissionKey) {
  const auth = requireAuth(event)
  if (event.context.apiKeyId) throw createError({ statusCode: 403, statusMessage: 'Las API keys no pueden usar el chat' })
  const permissions = await resolveChatPermissions(auth.tenantId, auth.sub)
  if (!permissions?.effective[key]) throw createError({ statusCode: 403, statusMessage: 'No tienes permiso para realizar esta acción en el chat' })
  return { auth, permissions }
}

export async function getRoleChatPermissions(tenantId: string, roleId: string) {
  return withTenant(tenantId, async tx => {
    const [role] = await tx.select({ id: roles.id, name: roles.name, isSystem: roles.isSystem }).from(roles)
      .where(and(eq(roles.id, roleId), eq(roles.tenantId, tenantId))).limit(1)
    if (!role) return null
    const [row] = await tx.select().from(roleChatPermissions).where(eq(roleChatPermissions.roleId, roleId)).limit(1)
    const permissions: ChatPermissionValues = role.isSystem
      ? { canAccess: true, canStartDirect: true, canSendAttachments: true, canCreateGroups: true }
      : {
          canAccess: row?.canAccess ?? true,
          canStartDirect: row?.canStartDirect ?? true,
          canSendAttachments: row?.canSendAttachments ?? true,
          canCreateGroups: row?.canCreateGroups ?? false
        }
    return { role, permissions }
  })
}

export async function setRoleChatPermissions(tenantId: string, roleId: string, values: ChatPermissionValues) {
  return withTenant(tenantId, async tx => {
    const [role] = await tx.select({ id: roles.id, name: roles.name, isSystem: roles.isSystem }).from(roles)
      .where(and(eq(roles.id, roleId), eq(roles.tenantId, tenantId))).limit(1)
    if (!role) return null
    const next = role.isSystem ? { canAccess: true, canStartDirect: true, canSendAttachments: true, canCreateGroups: true } : values
    await tx.insert(roleChatPermissions).values({ tenantId, roleId, ...next }).onConflictDoUpdate({
      target: roleChatPermissions.roleId,
      set: { ...next, updatedAt: new Date() }
    })
    await tx.insert(roleCapabilities).values({ tenantId, roleId, capabilityKey: 'communications.access', allowed: next.canAccess }).onConflictDoUpdate({
      target: [roleCapabilities.roleId, roleCapabilities.capabilityKey],
      set: { allowed: next.canAccess, updatedAt: new Date() }
    })
    return { role, permissions: next }
  })
}

export async function setUserChatPermissionOverrides(
  tenantId: string,
  userId: string,
  values: Record<ChatPermissionKey, boolean | null>
) {
  await withTenant(tenantId, async tx => {
    const [target] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, userId), eq(users.tenantId, tenantId))).limit(1)
    if (!target) throw createError({ statusCode: 404, statusMessage: 'Usuario no encontrado' })
    await tx.insert(userChatPermissionOverrides).values({ tenantId, userId, ...values }).onConflictDoUpdate({
      target: userChatPermissionOverrides.userId,
      set: { ...values, updatedAt: new Date() }
    })
    await tx.insert(userCapabilityOverrides).values({ tenantId, userId, capabilityKey: 'communications.access', allowed: values.canAccess }).onConflictDoUpdate({
      target: [userCapabilityOverrides.userId, userCapabilityOverrides.capabilityKey],
      set: { allowed: values.canAccess, updatedAt: new Date() }
    })
  })
  return resolveChatPermissions(tenantId, userId)
}
