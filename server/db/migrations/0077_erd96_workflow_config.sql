-- ERD-96: flujo opcional de estados asociado al módulo y a un campo Select.
ALTER TABLE entities ADD COLUMN workflow_config jsonb;
