export const CHAT_PERMISSION_KEYS = ['canAccess', 'canStartDirect', 'canSendAttachments', 'canCreateGroups'] as const
export type ChatPermissionKey = typeof CHAT_PERMISSION_KEYS[number]
export type ChatPermissionOverride = 'inherit' | 'allow' | 'deny'

export interface ChatPermissionValues {
  canAccess: boolean
  canStartDirect: boolean
  canSendAttachments: boolean
  canCreateGroups: boolean
}

export interface ResolvedChatPermissions {
  role: ChatPermissionValues
  overrides: Record<ChatPermissionKey, boolean | null>
  effective: ChatPermissionValues
  source: Record<ChatPermissionKey, 'role' | 'user'>
  roleName: string | null
}

export interface ChatPerson {
  id: string
  name: string
  email: string
  jobTitle: string | null
}

export interface ChatAttachment {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number
  url: string
}

export interface ChatMessage {
  id: string
  conversationId: string
  clientMessageId: string
  body: string
  sender: ChatPerson | null
  replyTo: { id: string; body: string; senderName: string } | null
  attachments: ChatAttachment[]
  editedAt: string | null
  deletedAt: string | null
  createdAt: string
  readCount: number
}

export interface ChatConversation {
  id: string
  type: 'direct' | 'group'
  title: string
  participants: ChatPerson[]
  participantCount: number
  lastMessage: (Pick<ChatMessage, 'id' | 'body' | 'createdAt' | 'deletedAt'> & { senderId: string | null; senderName: string | null }) | null
  lastMessageAt: string
  unreadCount: number
  archivedAt: string | null
  canManage: boolean
}
