import type { FlowAppKey } from '~/utils/flowApps'

export const FLOW_CAPABILITY_KEYS = [
  'core.access',
  'automation.access',
  'communications.access',
  'sites.access',
  'billing.access',
  'settings.access'
] as const

export type FlowCapabilityKey = typeof FLOW_CAPABILITY_KEYS[number]
export type FlowCapabilityValues = Record<FlowCapabilityKey, boolean>
export type FlowCapabilityOverrides = Record<FlowCapabilityKey, boolean | null>

export const FLOW_APP_ACCESS_CAPABILITY: Record<FlowAppKey, FlowCapabilityKey> = {
  core: 'core.access',
  automation: 'automation.access',
  communications: 'communications.access',
  sites: 'sites.access',
  billing: 'billing.access',
  settings: 'settings.access'
}

export const DEFAULT_FLOW_CAPABILITIES: FlowCapabilityValues = {
  'core.access': true,
  'automation.access': false,
  'communications.access': true,
  'sites.access': false,
  'billing.access': false,
  'settings.access': true
}

export interface ResolvedFlowCapabilities {
  role: FlowCapabilityValues
  overrides: FlowCapabilityOverrides
  effective: FlowCapabilityValues
  source: Record<FlowCapabilityKey, 'role' | 'user'>
  roleName: string | null
  isSystemRole: boolean
}

export interface AvailableFlowApp {
  key: FlowAppKey
  enabled: boolean
  accessible: boolean
}

