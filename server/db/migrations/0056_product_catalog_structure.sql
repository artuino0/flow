-- Estructura operativa del catálogo de productos.
-- Se conservan sku/nombre y los campos anteriores porque facturación,
-- inventarios y registros existentes dependen de ellos.

WITH product_entities AS (
  SELECT id FROM entities WHERE slug = 'productos'
), product_fields(name, label, data_type, validation_rules, is_required, sort_order) AS (
  VALUES
    ('activo', 'Activo', 'boolean', '{}'::jsonb, false, 0),
    ('sku', 'Código', 'text', '{"maxLength":40}'::jsonb, true, 1),
    ('nombre', 'Nombre de producto', 'text', '{"maxLength":160}'::jsonb, true, 2),
    ('cultivo', 'Cultivo', 'relation', '{"relationEntity":"cultivos"}'::jsonb, false, 3),
    ('nombre_extranjero', 'Nombre en el extranjero (inglés)', 'text', '{"maxLength":180}'::jsonb, false, 4),
    ('mercado_extranjero', 'Mercado extranjero', 'boolean', '{}'::jsonb, false, 5),
    ('envase', 'Envase', 'text', '{"maxLength":80}'::jsonb, false, 6),
    ('tamano_envase', 'Tamaño de envase', 'text', '{"maxLength":80}'::jsonb, false, 7),
    ('peso_unitario', 'Peso unitario', 'number', '{"min":0}'::jsonb, false, 8),
    ('peso_bruto', 'Peso bruto', 'number', '{"min":0}'::jsonb, false, 9),
    ('bultos_pallet', 'Bultos por pallet', 'number', '{"min":0,"integer":true}'::jsonb, false, 10),
    ('calidad', 'Calidad', 'select', '{"options":[{"value":"primera","label":"Primera","color":"success"},{"value":"segunda","label":"Segunda","color":"warning"},{"value":"industrial","label":"Industrial","color":"blue"},{"value":"sin_clasificar","label":"Sin clasificar","color":"neutral"}]}'::jsonb, false, 11),
    ('pti_directo', 'PTI directo', 'boolean', '{}'::jsonb, false, 12)
)
INSERT INTO entity_fields (id, entity_id, name, label, data_type, validation_rules, is_required, sort_order)
SELECT gen_random_uuid(), e.id, f.name, f.label, f.data_type, f.validation_rules, f.is_required, f.sort_order
FROM product_entities e
CROSS JOIN product_fields f
WHERE NOT EXISTS (
  SELECT 1 FROM entity_fields existing
  WHERE existing.entity_id = e.id AND existing.name = f.name
);

UPDATE entity_fields
SET label = CASE name
  WHEN 'sku' THEN 'Código'
  WHEN 'nombre' THEN 'Nombre de producto'
  ELSE label
END,
updated_at = now()
WHERE entity_id IN (SELECT id FROM entities WHERE slug = 'productos')
  AND name IN ('sku', 'nombre');

WITH product_order(name, position) AS (
  VALUES
    ('activo', 0), ('sku', 1), ('nombre', 2), ('cultivo', 3),
    ('nombre_extranjero', 4), ('mercado_extranjero', 5), ('envase', 6),
    ('tamano_envase', 7), ('peso_unitario', 8), ('peso_bruto', 9),
    ('bultos_pallet', 10), ('calidad', 11), ('pti_directo', 12),
    ('descripcion', 13), ('unidad', 14), ('categoria', 15),
    ('controla_lotes', 16), ('controla_caducidad', 17),
    ('costo_estandar', 18), ('clave_prod_serv', 19), ('estado', 20)
)
UPDATE entity_fields ef
SET sort_order = po.position, updated_at = now()
FROM product_order po
WHERE ef.entity_id IN (SELECT id FROM entities WHERE slug = 'productos')
  AND ef.name = po.name;

UPDATE entities
SET list_layout = jsonb_build_object(
  'columns', jsonb_build_array(
    jsonb_build_object('name','activo','visible',true),
    jsonb_build_object('name','sku','visible',true),
    jsonb_build_object('name','nombre','visible',true),
    jsonb_build_object('name','cultivo','visible',true),
    jsonb_build_object('name','nombre_extranjero','visible',true),
    jsonb_build_object('name','mercado_extranjero','visible',true),
    jsonb_build_object('name','envase','visible',true),
    jsonb_build_object('name','tamano_envase','visible',true),
    jsonb_build_object('name','peso_unitario','visible',true),
    jsonb_build_object('name','peso_bruto','visible',true),
    jsonb_build_object('name','bultos_pallet','visible',true),
    jsonb_build_object('name','calidad','visible',true),
    jsonb_build_object('name','pti_directo','visible',true)
  ),
  'filterFields', jsonb_build_array('activo','cultivo','mercado_extranjero','calidad'),
  'defaultSort', jsonb_build_object('field','sku','dir','asc')
),
detail_layout = jsonb_build_object(
  'properties', jsonb_build_array(
    jsonb_build_object('name','activo','visible',true),
    jsonb_build_object('name','sku','visible',true),
    jsonb_build_object('name','nombre','visible',true),
    jsonb_build_object('name','cultivo','visible',true),
    jsonb_build_object('name','nombre_extranjero','visible',true),
    jsonb_build_object('name','mercado_extranjero','visible',true),
    jsonb_build_object('name','envase','visible',true),
    jsonb_build_object('name','tamano_envase','visible',true),
    jsonb_build_object('name','peso_unitario','visible',true),
    jsonb_build_object('name','peso_bruto','visible',true),
    jsonb_build_object('name','bultos_pallet','visible',true),
    jsonb_build_object('name','calidad','visible',true),
    jsonb_build_object('name','pti_directo','visible',true)
  ),
  'relations', jsonb_build_array(),
  'showActivity', true
),
updated_at = now()
WHERE slug = 'productos';
