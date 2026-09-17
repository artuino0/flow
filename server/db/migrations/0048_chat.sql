CREATE TABLE IF NOT EXISTS role_chat_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  can_access boolean NOT NULL DEFAULT true,
  can_start_direct boolean NOT NULL DEFAULT true,
  can_send_attachments boolean NOT NULL DEFAULT true,
  can_create_groups boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT role_chat_permissions_role_unique UNIQUE (role_id)
);
CREATE INDEX IF NOT EXISTS role_chat_permissions_tenant_idx ON role_chat_permissions(tenant_id);

INSERT INTO role_chat_permissions (tenant_id, role_id, can_access, can_start_direct, can_send_attachments, can_create_groups)
SELECT tenant_id, id, true, true, true, is_system FROM roles
ON CONFLICT (role_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS user_chat_permission_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  can_access boolean,
  can_start_direct boolean,
  can_send_attachments boolean,
  can_create_groups boolean,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_chat_permission_overrides_user_unique UNIQUE (user_id)
);
CREATE INDEX IF NOT EXISTS user_chat_permission_overrides_tenant_idx ON user_chat_permission_overrides(tenant_id);

CREATE TABLE IF NOT EXISTS chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('direct', 'group')),
  title text,
  direct_key text,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  last_message_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_group_title_required CHECK (type <> 'group' OR (title IS NOT NULL AND length(trim(title)) > 0)),
  CONSTRAINT chat_direct_key_required CHECK ((type = 'direct' AND direct_key IS NOT NULL) OR (type = 'group' AND direct_key IS NULL))
);
CREATE INDEX IF NOT EXISTS chat_conversations_tenant_idx ON chat_conversations(tenant_id);
CREATE INDEX IF NOT EXISTS chat_conversations_recent_idx ON chat_conversations(tenant_id, last_message_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS chat_conversations_direct_unique ON chat_conversations(tenant_id, direct_key) WHERE direct_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS chat_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  participant_role text NOT NULL DEFAULT 'member' CHECK (participant_role IN ('owner', 'member')),
  archived_at timestamptz,
  last_read_at timestamptz NOT NULL DEFAULT now(),
  joined_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_participants_conversation_user_unique UNIQUE (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS chat_participants_inbox_idx ON chat_participants(tenant_id, user_id, archived_at);
CREATE INDEX IF NOT EXISTS chat_participants_conversation_idx ON chat_participants(conversation_id);

CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  sender_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  client_message_id uuid NOT NULL,
  body text NOT NULL DEFAULT '',
  reply_to_message_id uuid REFERENCES chat_messages(id) ON DELETE SET NULL,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_client_message_unique ON chat_messages(conversation_id, sender_user_id, client_message_id);
CREATE INDEX IF NOT EXISTS chat_messages_conversation_created_idx ON chat_messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS chat_messages_tenant_idx ON chat_messages(tenant_id);

CREATE TABLE IF NOT EXISTS chat_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id uuid REFERENCES chat_messages(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL,
  storage_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_attachments_tenant_idx ON chat_attachments(tenant_id);
CREATE INDEX IF NOT EXISTS chat_attachments_message_idx ON chat_attachments(message_id);
CREATE INDEX IF NOT EXISTS chat_attachments_owner_idx ON chat_attachments(uploaded_by);

GRANT SELECT, INSERT, UPDATE, DELETE ON role_chat_permissions, user_chat_permission_overrides, chat_conversations, chat_participants, chat_messages, chat_attachments TO erp_app;

ALTER TABLE role_chat_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_chat_permissions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_role_chat_permissions ON role_chat_permissions USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
ALTER TABLE user_chat_permission_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_chat_permission_overrides FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_user_chat_permission_overrides ON user_chat_permission_overrides USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_conversations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_chat_conversations ON chat_conversations USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
ALTER TABLE chat_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_participants FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_chat_participants ON chat_participants USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_chat_messages ON chat_messages USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
ALTER TABLE chat_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_attachments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_chat_attachments ON chat_attachments USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
