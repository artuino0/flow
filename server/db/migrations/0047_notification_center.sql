CREATE TABLE IF NOT EXISTS notification_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_groups_tenant_name_unique UNIQUE (tenant_id, name)
);
CREATE INDEX IF NOT EXISTS notification_groups_tenant_idx ON notification_groups(tenant_id);
CREATE TABLE IF NOT EXISTS notification_group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES notification_groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_group_members_group_user_unique UNIQUE (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS notification_group_members_group_idx ON notification_group_members(group_id);
CREATE INDEX IF NOT EXISTS notification_group_members_user_idx ON notification_group_members(user_id);
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'MENTION',
  title text NOT NULL,
  message text NOT NULL,
  entity_slug text,
  record_id uuid REFERENCES records(id) ON DELETE CASCADE,
  activity_id uuid REFERENCES record_activities(id) ON DELETE CASCADE,
  action_url text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_inbox_idx ON notifications(tenant_id, user_id, created_at);
CREATE INDEX IF NOT EXISTS notifications_unread_idx ON notifications(tenant_id, user_id, read_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON notification_groups, notification_group_members, notifications TO erp_app;
ALTER TABLE notification_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_groups FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_notification_groups ON notification_groups;
CREATE POLICY tenant_isolation_notification_groups ON notification_groups USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
ALTER TABLE notification_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_group_members FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_notification_group_members ON notification_group_members;
CREATE POLICY tenant_isolation_notification_group_members ON notification_group_members USING (group_id IN (SELECT id FROM notification_groups WHERE tenant_id = current_setting('app.tenant_id', true)::uuid));
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_notifications ON notifications;
CREATE POLICY tenant_isolation_notifications ON notifications USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
