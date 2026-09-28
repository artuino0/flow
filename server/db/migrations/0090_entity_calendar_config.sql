ALTER TABLE entities ADD COLUMN calendar_config jsonb;

INSERT INTO entity_fields (entity_id, name, label, data_type, validation_rules, sort_order)
SELECT entity.id, 'duracion_minutos', 'Duración en minutos', 'number', '{"min":1,"integer":true}'::jsonb,
  coalesce((SELECT max(field.sort_order) + 1 FROM entity_fields field WHERE field.entity_id = entity.id), 0)
FROM entities entity
WHERE entity.template_key = 'agenda' AND entity.slug = 'agenda-citas'
  AND NOT EXISTS (SELECT 1 FROM entity_fields field WHERE field.entity_id = entity.id AND field.name = 'duracion_minutos');

UPDATE entities SET calendar_config = '{"enabled":true,"startDateField":"fecha","startTimeField":"hora","durationField":"duracion_minutos","endField":null,"titleField":"asunto","colorField":"estado","groupByField":"personal","defaultView":"day"}'::jsonb
WHERE template_key = 'agenda' AND slug = 'agenda-citas' AND calendar_config IS NULL;
