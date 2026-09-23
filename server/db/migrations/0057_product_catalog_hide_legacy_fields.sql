-- La estructura visible del catálogo de Productos reemplaza los campos
-- internos anteriores; los valores se conservan para compatibilidad.

UPDATE entities
SET list_layout = jsonb_set(
  list_layout,
  '{columns}',
  COALESCE(list_layout->'columns', '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object('name','descripcion','visible',false),
    jsonb_build_object('name','unidad','visible',false),
    jsonb_build_object('name','categoria','visible',false),
    jsonb_build_object('name','controla_lotes','visible',false),
    jsonb_build_object('name','controla_caducidad','visible',false),
    jsonb_build_object('name','costo_estandar','visible',false),
    jsonb_build_object('name','clave_prod_serv','visible',false),
    jsonb_build_object('name','estado','visible',false)
  )
),
detail_layout = jsonb_set(
  detail_layout,
  '{properties}',
  COALESCE(detail_layout->'properties', '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object('name','descripcion','visible',false),
    jsonb_build_object('name','unidad','visible',false),
    jsonb_build_object('name','categoria','visible',false),
    jsonb_build_object('name','controla_lotes','visible',false),
    jsonb_build_object('name','controla_caducidad','visible',false),
    jsonb_build_object('name','costo_estandar','visible',false),
    jsonb_build_object('name','clave_prod_serv','visible',false),
    jsonb_build_object('name','estado','visible',false)
  )
),
updated_at = now()
WHERE slug = 'productos';
