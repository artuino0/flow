ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS shared_record jsonb;
GRANT SELECT, INSERT, UPDATE, DELETE ON chat_messages TO erp_app;
