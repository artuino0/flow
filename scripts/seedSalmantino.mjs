// Seed de demostracion "Grupo Agricola Salmantino" (pedido directo del
// usuario, 2026-09-06): un tenant nuevo, de punta a punta, con una
// estructura de datos mas parecida a un sistema real de empacadora (estilo
// INTEBA) que el flujo minimo de scripts/seedEmpaque.mjs (que solo tenia 5
// entidades, con hasta 5 campos cada una). Aca cada catalogo/tabla tiene
// entre 6 y 11 campos reales, con relaciones encadenadas de varios niveles
// (Recepcion -> Finca -> Productor, Empaque -> Recepcion -> Variedad ->
// Especie, Embarque -> Detalle -> Palet -> Camara) - pensado para poder
// probar de verdad el diseñador de reportes imprimibles (ERD-88) contra un
// caso con mas de un salto de relacion.
//
// Dominio: Grupo Agricola Salmantino exporta verduras frescas - pimiento
// (rojo/amarillo/verde), pepino persa (convencional y organico), tomate
// (cherry y heirloom) y berenjena organica.
//
// A diferencia de scripts/seedEmpaque.mjs y scripts/seed.mjs (que solo crean
// METADATOS sobre un tenant ya existente), este script crea el tenant + rol
// Administrador + usuario de punta a punta (mismo patron que
// scripts/seed-dev-user.mjs) Y ADEMAS inserta records de ejemplo reales
// directo en la tabla `records` (igual que hacen los tests de integracion) -
// porque no hay forma de "poblar con datos" sin pasar por la API real ni
// escribir directo a la base, y este script esta pensado para correr una
// sola vez contra una base recien migrada (no idempotente a proposito: si el
// tenant/slug ya existe, falla en vez de duplicar datos).
//
// Uso (contra una base YA migrada - npm run db:migrate):
//   node scripts/seedSalmantino.mjs
//
// Variables opcionales:
//   SALMANTINO_EMAIL     (default: arturosistemas94@gmail.com)
//   SALMANTINO_PASSWORD  (default: Salmantino2026)

import postgres from 'postgres'
import bcrypt from 'bcryptjs'

const connectionString =
  process.env.APP_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://erp_app:changeme_app@localhost:5433/erp_dinamico'

const ORG_NAME = 'Grupo Agrícola Salmantino'
const ORG_SLUG = 'grupo-agricola-salmantino'
const PERSON_NAME = 'Arturo Muñoz'
const PERSON_EMAIL = process.env.SALMANTINO_EMAIL || 'arturosistemas94@gmail.com'
const PERSON_PASSWORD = process.env.SALMANTINO_PASSWORD || 'Salmantino2026'

// ---------------------------------------------------------------------------
// Definicion de metadatos: 10 catalogos (moduleKind 'dimension' - se
// consultan al capturar una transaccion, no se crean a diario) + 5 entidades
// transaccionales (moduleKind 'hecho', el default). Orden deliberado: cada
// entidad solo referencia (via dataType 'relation') entidades YA definidas
// arriba en esta misma lista.
//
// 'folio' (dataType 'incremental') en las 5 transaccionales reemplaza el
// texto libre "folio_pallet"/"folio_guia" que tenia scripts/seedEmpaque.mjs -
// aca es un correlativo real, generado por este mismo script con la misma
// logica atomica que server/utils/incrementalField.ts (ver nextFolio() mas
// abajo), para que folios nuevos creados despues desde la UI sigan la
// secuencia sin colisionar. Sin prefijo (prefixSource) para no complicar el
// seed - la funcionalidad de prefijo ya esta cubierta por HU-ERD-84 y no es
// el foco de este dataset.

const EMAIL_REGEX_SRC = '^[^@]+@[^@]+\\.[^@]+$'

const entityDefs = [
  {
    slug: 'productores',
    name: 'Productores',
    singularName: 'Productor',
    icon: 'Contact',
    moduleKind: 'dimension',
    labelField: 'nombre',
    fields: [
      { name: 'nombre', label: 'Nombre', dataType: 'text', isRequired: true, validationRules: { maxLength: 150 } },
      { name: 'identificacion_fiscal', label: 'Identificación fiscal', dataType: 'text', isRequired: false, validationRules: { maxLength: 40 } },
      { name: 'contacto_nombre', label: 'Contacto', dataType: 'text', isRequired: false, validationRules: { maxLength: 120 } },
      { name: 'telefono', label: 'Teléfono', dataType: 'text', isRequired: false, validationRules: { maxLength: 20 } },
      { name: 'email', label: 'Correo', dataType: 'text', isRequired: false, validationRules: { pattern: EMAIL_REGEX_SRC } },
      { name: 'direccion', label: 'Dirección', dataType: 'text', isRequired: false, validationRules: { maxLength: 200 } },
      { name: 'municipio', label: 'Municipio', dataType: 'text', isRequired: false, validationRules: { maxLength: 100 } },
      { name: 'estado', label: 'Estado', dataType: 'text', isRequired: false, validationRules: { maxLength: 100 } },
      { name: 'certificado_organico', label: 'Certificado orgánico', dataType: 'boolean', isRequired: false, validationRules: {} },
      { name: 'activo', label: 'Activo', dataType: 'boolean', isRequired: false, validationRules: {} }
    ]
  },
  {
    slug: 'fincas',
    name: 'Fincas',
    singularName: 'Finca',
    icon: 'Sprout',
    moduleKind: 'dimension',
    labelField: 'nombre',
    fields: [
      { name: 'nombre', label: 'Nombre', dataType: 'text', isRequired: true, validationRules: { maxLength: 150 } },
      { name: 'productor', label: 'Productor', dataType: 'relation', isRequired: true, validationRules: { relationEntity: 'productores' } },
      { name: 'hectareas', label: 'Hectáreas', dataType: 'number', isRequired: false, validationRules: { min: 0 } },
      {
        name: 'tipo_riego',
        label: 'Tipo de riego',
        dataType: 'select',
        isRequired: false,
        validationRules: {
          options: [
            { value: 'goteo', label: 'Goteo', color: 'success' },
            { value: 'aspersion', label: 'Aspersión', color: 'blue' },
            { value: 'gravedad', label: 'Gravedad', color: 'neutral' },
            { value: 'temporal', label: 'Temporal', color: 'warning' }
          ]
        }
      },
      { name: 'municipio', label: 'Municipio', dataType: 'text', isRequired: false, validationRules: { maxLength: 100 } },
      { name: 'certificacion_organica', label: 'Certificación orgánica', dataType: 'boolean', isRequired: false, validationRules: {} },
      { name: 'altitud_msnm', label: 'Altitud (msnm)', dataType: 'number', isRequired: false, validationRules: { min: 0 } },
      { name: 'activa', label: 'Activa', dataType: 'boolean', isRequired: false, validationRules: {} }
    ]
  },
  {
    slug: 'especies',
    name: 'Especies',
    singularName: 'Especie',
    icon: 'Leaf',
    moduleKind: 'dimension',
    labelField: 'nombre',
    fields: [
      { name: 'nombre', label: 'Nombre', dataType: 'text', isRequired: true, validationRules: { maxLength: 80 } },
      { name: 'nombre_cientifico', label: 'Nombre científico', dataType: 'text', isRequired: false, validationRules: { maxLength: 120 } },
      { name: 'familia_botanica', label: 'Familia botánica', dataType: 'text', isRequired: false, validationRules: { maxLength: 80 } },
      {
        name: 'temporada',
        label: 'Temporada',
        dataType: 'select',
        isRequired: false,
        validationRules: {
          options: [
            { value: 'primavera', label: 'Primavera', color: 'success' },
            { value: 'verano', label: 'Verano', color: 'warning' },
            { value: 'otono', label: 'Otoño', color: 'blue' },
            { value: 'invierno', label: 'Invierno', color: 'neutral' },
            { value: 'todo_el_ano', label: 'Todo el año', color: 'purple' }
          ]
        }
      },
      { name: 'dias_promedio_cosecha', label: 'Días promedio a cosecha', dataType: 'number', isRequired: false, validationRules: { min: 0 } },
      {
        name: 'unidad_cosecha',
        label: 'Unidad de cosecha',
        dataType: 'select',
        isRequired: false,
        validationRules: {
          options: [
            { value: 'kg', label: 'Kilogramos', color: 'neutral' },
            { value: 'caja', label: 'Caja', color: 'blue' },
            { value: 'tonelada', label: 'Tonelada', color: 'purple' }
          ]
        }
      }
    ]
  },
  {
    slug: 'variedades',
    name: 'Variedades',
    singularName: 'Variedad',
    icon: 'Tags',
    moduleKind: 'dimension',
    labelField: 'nombre',
    fields: [
      { name: 'nombre', label: 'Nombre', dataType: 'text', isRequired: true, validationRules: { maxLength: 100 } },
      { name: 'especie', label: 'Especie', dataType: 'relation', isRequired: true, validationRules: { relationEntity: 'especies' } },
      {
        name: 'tipo_cultivo',
        label: 'Tipo de cultivo',
        dataType: 'select',
        isRequired: true,
        validationRules: {
          options: [
            { value: 'convencional', label: 'Convencional', color: 'neutral' },
            { value: 'organico', label: 'Orgánico', color: 'success' }
          ]
        }
      },
      {
        name: 'color',
        label: 'Color',
        dataType: 'select',
        isRequired: false,
        validationRules: {
          options: [
            { value: 'rojo', label: 'Rojo', color: 'error' },
            { value: 'amarillo', label: 'Amarillo', color: 'warning' },
            { value: 'verde', label: 'Verde', color: 'success' },
            { value: 'morado', label: 'Morado', color: 'purple' },
            { value: 'rosado', label: 'Rosado', color: 'pink' },
            { value: 'na', label: 'No aplica', color: 'neutral' }
          ]
        }
      },
      { name: 'dias_a_cosecha', label: 'Días a cosecha', dataType: 'number', isRequired: false, validationRules: { min: 0 } },
      { name: 'rendimiento_esperado_kg_ha', label: 'Rendimiento esperado (kg/ha)', dataType: 'number', isRequired: false, validationRules: { min: 0 } },
      {
        name: 'certificacion',
        label: 'Certificación',
        dataType: 'select',
        isRequired: false,
        validationRules: {
          options: [
            { value: 'ninguna', label: 'Ninguna', color: 'neutral' },
            { value: 'usda_organic', label: 'USDA Organic', color: 'success' },
            { value: 'senasica_organico', label: 'SENASICA Orgánico', color: 'success' }
          ]
        }
      },
      { name: 'activo', label: 'Activo', dataType: 'boolean', isRequired: false, validationRules: {} }
    ]
  },
  {
    slug: 'clientes',
    name: 'Clientes',
    singularName: 'Cliente',
    icon: 'Building2',
    moduleKind: 'dimension',
    labelField: 'nombre',
    fields: [
      { name: 'nombre', label: 'Nombre', dataType: 'text', isRequired: true, validationRules: { maxLength: 150 } },
      {
        name: 'pais',
        label: 'País',
        dataType: 'select',
        isRequired: false,
        validationRules: {
          options: [
            { value: 'estados_unidos', label: 'Estados Unidos', color: 'blue' },
            { value: 'canada', label: 'Canadá', color: 'error' },
            { value: 'japon', label: 'Japón', color: 'pink' },
            { value: 'corea_del_sur', label: 'Corea del Sur', color: 'purple' },
            { value: 'union_europea', label: 'Unión Europea', color: 'warning' },
            { value: 'reino_unido', label: 'Reino Unido', color: 'neutral' },
            { value: 'otro', label: 'Otro', color: 'neutral' }
          ]
        }
      },
      { name: 'ciudad', label: 'Ciudad', dataType: 'text', isRequired: false, validationRules: { maxLength: 100 } },
      { name: 'contacto_nombre', label: 'Contacto', dataType: 'text', isRequired: false, validationRules: { maxLength: 120 } },
      { name: 'email', label: 'Correo', dataType: 'text', isRequired: false, validationRules: { pattern: EMAIL_REGEX_SRC } },
      { name: 'telefono', label: 'Teléfono', dataType: 'text', isRequired: false, validationRules: { maxLength: 20 } },
      {
        name: 'incoterm',
        label: 'Incoterm',
        dataType: 'select',
        isRequired: false,
        validationRules: {
          options: [
            { value: 'fob', label: 'FOB', color: 'blue' },
            { value: 'cif', label: 'CIF', color: 'purple' },
            { value: 'exw', label: 'EXW', color: 'neutral' },
            { value: 'dap', label: 'DAP', color: 'success' },
            { value: 'fca', label: 'FCA', color: 'warning' }
          ]
        }
      },
      {
        name: 'moneda',
        label: 'Moneda',
        dataType: 'select',
        isRequired: false,
        validationRules: {
          options: [
            { value: 'usd', label: 'USD', color: 'success' },
            { value: 'mxn', label: 'MXN', color: 'neutral' },
            { value: 'eur', label: 'EUR', color: 'blue' }
          ]
        }
      },
      { name: 'activo', label: 'Activo', dataType: 'boolean', isRequired: false, validationRules: {} }
    ]
  },
  {
    slug: 'transportistas',
    name: 'Transportistas',
    singularName: 'Transportista',
    icon: 'Truck',
    moduleKind: 'dimension',
    labelField: 'nombre',
    fields: [
      { name: 'nombre', label: 'Nombre', dataType: 'text', isRequired: true, validationRules: { maxLength: 150 } },
      { name: 'rfc', label: 'RFC', dataType: 'text', isRequired: false, validationRules: { maxLength: 20 } },
      { name: 'telefono', label: 'Teléfono', dataType: 'text', isRequired: false, validationRules: { maxLength: 20 } },
      {
        name: 'tipo_servicio',
        label: 'Tipo de servicio',
        dataType: 'select',
        isRequired: false,
        validationRules: {
          options: [
            { value: 'local', label: 'Local', color: 'neutral' },
            { value: 'internacional', label: 'Internacional', color: 'blue' },
            { value: 'ambos', label: 'Ambos', color: 'purple' }
          ]
        }
      },
      { name: 'numero_permiso_sct', label: 'Número de permiso SCT', dataType: 'text', isRequired: false, validationRules: { maxLength: 40 } },
      { name: 'activo', label: 'Activo', dataType: 'boolean', isRequired: false, validationRules: {} }
    ]
  },
  {
    slug: 'vehiculos',
    name: 'Vehículos',
    singularName: 'Vehículo',
    icon: 'Car',
    moduleKind: 'dimension',
    labelField: 'placa',
    fields: [
      { name: 'placa', label: 'Placa', dataType: 'text', isRequired: true, validationRules: { maxLength: 20 } },
      { name: 'transportista', label: 'Transportista', dataType: 'relation', isRequired: true, validationRules: { relationEntity: 'transportistas' } },
      {
        name: 'tipo',
        label: 'Tipo',
        dataType: 'select',
        isRequired: false,
        validationRules: {
          options: [
            { value: 'refrigerado', label: 'Refrigerado', color: 'blue' },
            { value: 'seco', label: 'Seco', color: 'neutral' },
            { value: 'plataforma', label: 'Plataforma', color: 'warning' }
          ]
        }
      },
      { name: 'capacidad_kg', label: 'Capacidad (kg)', dataType: 'number', isRequired: false, validationRules: { min: 0 } },
      { name: 'marca', label: 'Marca', dataType: 'text', isRequired: false, validationRules: { maxLength: 60 } },
      { name: 'modelo', label: 'Modelo', dataType: 'text', isRequired: false, validationRules: { maxLength: 60 } },
      { name: 'anio', label: 'Año', dataType: 'number', isRequired: false, validationRules: {} },
      { name: 'activo', label: 'Activo', dataType: 'boolean', isRequired: false, validationRules: {} }
    ]
  },
  {
    slug: 'choferes',
    name: 'Choferes',
    singularName: 'Chofer',
    icon: 'IdCard',
    moduleKind: 'dimension',
    labelField: 'nombre',
    fields: [
      { name: 'nombre', label: 'Nombre', dataType: 'text', isRequired: true, validationRules: { maxLength: 150 } },
      { name: 'transportista', label: 'Transportista', dataType: 'relation', isRequired: false, validationRules: { relationEntity: 'transportistas' } },
      { name: 'licencia', label: 'Licencia', dataType: 'text', isRequired: false, validationRules: { maxLength: 40 } },
      { name: 'telefono', label: 'Teléfono', dataType: 'text', isRequired: false, validationRules: { maxLength: 20 } },
      { name: 'vencimiento_licencia', label: 'Vencimiento de licencia', dataType: 'date', isRequired: false, validationRules: {} },
      { name: 'activo', label: 'Activo', dataType: 'boolean', isRequired: false, validationRules: {} }
    ]
  },
  {
    slug: 'camaras_frio',
    name: 'Cámaras de Frío',
    singularName: 'Cámara de Frío',
    icon: 'Snowflake',
    moduleKind: 'dimension',
    labelField: 'nombre',
    fields: [
      { name: 'nombre', label: 'Nombre', dataType: 'text', isRequired: true, validationRules: { maxLength: 60 } },
      { name: 'temperatura_objetivo_c', label: 'Temperatura objetivo (°C)', dataType: 'number', isRequired: false, validationRules: {} },
      { name: 'humedad_objetivo_pct', label: 'Humedad objetivo (%)', dataType: 'number', isRequired: false, validationRules: { min: 0, max: 100 } },
      { name: 'capacidad_pallets', label: 'Capacidad (pallets)', dataType: 'number', isRequired: false, validationRules: { min: 0 } },
      { name: 'ubicacion', label: 'Ubicación', dataType: 'text', isRequired: false, validationRules: { maxLength: 100 } },
      { name: 'activa', label: 'Activa', dataType: 'boolean', isRequired: false, validationRules: {} }
    ]
  },
  {
    slug: 'presentaciones',
    name: 'Presentaciones',
    singularName: 'Presentación',
    icon: 'Box',
    moduleKind: 'dimension',
    labelField: 'nombre',
    fields: [
      { name: 'nombre', label: 'Nombre', dataType: 'text', isRequired: true, validationRules: { maxLength: 100 } },
      { name: 'capacidad_kg', label: 'Capacidad (kg)', dataType: 'number', isRequired: false, validationRules: { min: 0 } },
      { name: 'unidades_por_caja', label: 'Unidades por caja', dataType: 'number', isRequired: false, validationRules: { min: 0 } },
      {
        name: 'material',
        label: 'Material',
        dataType: 'select',
        isRequired: false,
        validationRules: {
          options: [
            { value: 'carton', label: 'Cartón', color: 'neutral' },
            { value: 'plastico', label: 'Plástico', color: 'blue' },
            { value: 'madera', label: 'Madera', color: 'warning' }
          ]
        }
      },
      { name: 'reciclable', label: 'Reciclable', dataType: 'boolean', isRequired: false, validationRules: {} },
      { name: 'activo', label: 'Activo', dataType: 'boolean', isRequired: false, validationRules: {} }
    ]
  },
  // ---- Catalogos arriba, entidades transaccionales ("hecho") abajo ----
  {
    slug: 'palets',
    name: 'Palets',
    singularName: 'Palet',
    icon: 'Container',
    labelField: 'folio',
    fields: [
      { name: 'folio', label: 'Folio', dataType: 'incremental', isRequired: false, validationRules: { digits: 5 } },
      { name: 'camara', label: 'Cámara de frío', dataType: 'relation', isRequired: true, validationRules: { relationEntity: 'camaras_frio' } },
      { name: 'fecha_ingreso', label: 'Fecha de ingreso', dataType: 'date', isRequired: true, validationRules: {} },
      {
        name: 'estado',
        label: 'Estado',
        dataType: 'select',
        isRequired: false,
        validationRules: {
          options: [
            { value: 'en_camara', label: 'En cámara', color: 'blue' },
            { value: 'reservado', label: 'Reservado', color: 'warning' },
            { value: 'despachado', label: 'Despachado', color: 'success' }
          ]
        }
      },
      { name: 'cantidad_cajas', label: 'Cantidad de cajas', dataType: 'number', isRequired: false, validationRules: { min: 0 } },
      { name: 'kilos_totales', label: 'Kilos totales', dataType: 'number', isRequired: false, validationRules: { min: 0 } },
      { name: 'observaciones', label: 'Observaciones', dataType: 'text', isRequired: false, validationRules: { maxLength: 200 } }
    ]
  },
  {
    slug: 'recepciones',
    name: 'Recepciones',
    singularName: 'Recepción',
    icon: 'ClipboardList',
    labelField: 'folio',
    fields: [
      { name: 'folio', label: 'Folio', dataType: 'incremental', isRequired: false, validationRules: { digits: 6 } },
      { name: 'fecha', label: 'Fecha', dataType: 'date', isRequired: true, validationRules: {} },
      { name: 'finca', label: 'Finca', dataType: 'relation', isRequired: true, validationRules: { relationEntity: 'fincas' } },
      { name: 'variedad', label: 'Variedad', dataType: 'relation', isRequired: true, validationRules: { relationEntity: 'variedades' } },
      { name: 'chofer', label: 'Chofer', dataType: 'relation', isRequired: false, validationRules: { relationEntity: 'choferes' } },
      { name: 'vehiculo', label: 'Vehículo', dataType: 'relation', isRequired: false, validationRules: { relationEntity: 'vehiculos' } },
      { name: 'kilos_recibidos', label: 'Kilos recibidos', dataType: 'number', isRequired: true, validationRules: { min: 0 } },
      { name: 'temperatura_recepcion_c', label: 'Temperatura de recepción (°C)', dataType: 'number', isRequired: false, validationRules: {} },
      { name: 'lote_campo', label: 'Lote de campo', dataType: 'text', isRequired: false, validationRules: { maxLength: 40 } },
      {
        name: 'calidad_visual',
        label: 'Calidad visual',
        dataType: 'select',
        isRequired: false,
        validationRules: {
          options: [
            { value: 'excelente', label: 'Excelente', color: 'success' },
            { value: 'buena', label: 'Buena', color: 'blue' },
            { value: 'regular', label: 'Regular', color: 'warning' },
            { value: 'rechazo', label: 'Rechazo', color: 'error' }
          ]
        }
      },
      { name: 'observaciones', label: 'Observaciones', dataType: 'text', isRequired: false, validationRules: { maxLength: 300 } }
    ]
  },
  {
    slug: 'empaques',
    name: 'Empaques',
    singularName: 'Empaque',
    icon: 'PackageCheck',
    labelField: 'folio',
    fields: [
      { name: 'folio', label: 'Folio', dataType: 'incremental', isRequired: false, validationRules: { digits: 6 } },
      { name: 'fecha', label: 'Fecha', dataType: 'date', isRequired: true, validationRules: {} },
      { name: 'recepcion', label: 'Recepción de origen', dataType: 'relation', isRequired: true, validationRules: { relationEntity: 'recepciones' } },
      { name: 'presentacion', label: 'Presentación', dataType: 'relation', isRequired: true, validationRules: { relationEntity: 'presentaciones' } },
      {
        name: 'categoria',
        label: 'Categoría',
        dataType: 'select',
        isRequired: true,
        validationRules: {
          options: [
            { value: 'extra', label: 'Extra', color: 'success' },
            { value: 'primera', label: 'Primera', color: 'blue' },
            { value: 'segunda', label: 'Segunda', color: 'warning' },
            { value: 'industrial', label: 'Industrial', color: 'purple' },
            { value: 'descarte', label: 'Descarte', color: 'error' }
          ]
        }
      },
      { name: 'calibre', label: 'Calibre', dataType: 'text', isRequired: false, validationRules: { maxLength: 20 } },
      { name: 'kilos_empacados', label: 'Kilos empacados', dataType: 'number', isRequired: true, validationRules: { min: 0 } },
      { name: 'cajas_producidas', label: 'Cajas producidas', dataType: 'number', isRequired: false, validationRules: { min: 0 } },
      { name: 'kilos_merma', label: 'Kilos de merma', dataType: 'number', isRequired: false, validationRules: { min: 0 } },
      { name: 'camara', label: 'Cámara de frío', dataType: 'relation', isRequired: false, validationRules: { relationEntity: 'camaras_frio' } },
      { name: 'palet', label: 'Palet', dataType: 'relation', isRequired: false, validationRules: { relationEntity: 'palets' } }
    ]
  },
  {
    slug: 'embarques',
    name: 'Embarques',
    singularName: 'Embarque',
    icon: 'Ship',
    labelField: 'folio',
    fields: [
      { name: 'folio', label: 'Folio', dataType: 'incremental', isRequired: false, validationRules: { digits: 5 } },
      { name: 'fecha_salida', label: 'Fecha de salida', dataType: 'date', isRequired: true, validationRules: {} },
      { name: 'cliente', label: 'Cliente', dataType: 'relation', isRequired: true, validationRules: { relationEntity: 'clientes' } },
      { name: 'transportista', label: 'Transportista', dataType: 'relation', isRequired: false, validationRules: { relationEntity: 'transportistas' } },
      { name: 'chofer', label: 'Chofer', dataType: 'relation', isRequired: false, validationRules: { relationEntity: 'choferes' } },
      { name: 'contenedor', label: 'Contenedor', dataType: 'text', isRequired: false, validationRules: { maxLength: 30 } },
      { name: 'sello_seguridad', label: 'Sello de seguridad', dataType: 'text', isRequired: false, validationRules: { maxLength: 30 } },
      { name: 'temperatura_transporte_c', label: 'Temperatura de transporte (°C)', dataType: 'number', isRequired: false, validationRules: {} },
      { name: 'fecha_estimada_llegada', label: 'Fecha estimada de llegada', dataType: 'date', isRequired: false, validationRules: {} },
      {
        name: 'estado',
        label: 'Estado',
        dataType: 'select',
        isRequired: false,
        validationRules: {
          options: [
            { value: 'programado', label: 'Programado', color: 'neutral' },
            { value: 'en_transito', label: 'En tránsito', color: 'blue' },
            { value: 'entregado', label: 'Entregado', color: 'success' },
            { value: 'cancelado', label: 'Cancelado', color: 'error' }
          ]
        }
      },
      { name: 'observaciones', label: 'Observaciones', dataType: 'text', isRequired: false, validationRules: { maxLength: 300 } }
    ]
  },
  {
    slug: 'detalle_embarques',
    name: 'Detalle de Embarques',
    singularName: 'Detalle de Embarque',
    icon: 'Package2',
    fields: [
      { name: 'embarque', label: 'Embarque', dataType: 'relation', isRequired: true, validationRules: { relationEntity: 'embarques' } },
      { name: 'palet', label: 'Palet', dataType: 'relation', isRequired: true, validationRules: { relationEntity: 'palets' } },
      { name: 'cajas', label: 'Cajas', dataType: 'number', isRequired: true, validationRules: { min: 0 } },
      { name: 'kilos', label: 'Kilos', dataType: 'number', isRequired: true, validationRules: { min: 0 } },
      { name: 'precio_unitario_usd', label: 'Precio unitario (USD)', dataType: 'number', isRequired: false, validationRules: { min: 0 } },
      { name: 'importe_usd', label: 'Importe (USD)', dataType: 'number', isRequired: false, validationRules: { min: 0 } }
    ]
  }
]

const sql = postgres(connectionString)

/**
 * Mismo algoritmo atomico que nextCounterValue() de
 * server/utils/incrementalField.ts (upsert con lastValue = lastValue + 1
 * calculado EN el UPDATE) - se llama a mano aca porque este script no pasa
 * por POST /api/records/:entity (inserta directo en `records`), pero deja el
 * contador consistente para que un folio nuevo creado despues desde la UI
 * continue la secuencia sin repetir numero.
 */
async function nextFolio(tx, entityFieldId, digits, prefix = '') {
  const [row] = await tx`
    insert into entity_field_counters (entity_field_id, prefix, last_value)
    values (${entityFieldId}, ${prefix}, 1)
    on conflict (entity_field_id, prefix) do update set last_value = entity_field_counters.last_value + 1, updated_at = now()
    returning last_value
  `
  return prefix + String(row.last_value).padStart(digits, '0')
}

async function insertRecord(tx, tenantId, entityId, customData) {
  const [row] = await tx`
    insert into records (tenant_id, entity_id, custom_data)
    values (${tenantId}, ${entityId}, ${sql.json(customData)})
    returning id
  `
  return row.id
}

try {
  const passwordHash = await bcrypt.hash(PERSON_PASSWORD, 12)

  const [tenant] = await sql`
    insert into tenants (name, slug)
    values (${ORG_NAME}, ${ORG_SLUG})
    returning id
  `
  const tenantId = tenant.id

  const entityByslug = {}

  await sql.begin(async (tx) => {
    await tx`select set_config('app.tenant_id', ${tenantId}, true), set_config('app.record_system', 'on', true)`

    // ---- rol Administrador + persona + membresia (mismo patron que scripts/seed-dev-user.mjs) ----
    const [adminRole] = await tx`
      insert into roles (tenant_id, name, is_system)
      values (${tenantId}, 'Administrador', true)
      returning id
    `

    const [existingPerson] = await tx`select id from people where email = ${PERSON_EMAIL}`
    const personId = existingPerson
      ? existingPerson.id
      : (await tx`insert into people (email, password_hash, full_name) values (${PERSON_EMAIL}, ${passwordHash}, ${PERSON_NAME}) returning id`)[0].id

    await tx`insert into users (tenant_id, person_id, role_id, is_active) values (${tenantId}, ${personId}, ${adminRole.id}, true)`

    // ---- metadatos: entities + entity_fields + permisos del rol Administrador ----
    for (const def of entityDefs) {
      const [entity] = await tx`
        insert into entities (tenant_id, name, slug, singular_name, icon, module_kind, label_field)
        values (${tenantId}, ${def.name}, ${def.slug}, ${def.singularName}, ${def.icon}, ${def.moduleKind ?? 'hecho'}, ${def.labelField ?? null})
        returning id
      `
      const fieldsByName = {}
      for (let i = 0; i < def.fields.length; i++) {
        const field = def.fields[i]
        const [row] = await tx`
          insert into entity_fields (entity_id, name, label, data_type, validation_rules, is_required, sort_order)
          values (${entity.id}, ${field.name}, ${field.label}, ${field.dataType}, ${sql.json(field.validationRules)}, ${field.isRequired}, ${i})
          returning id
        `
        fieldsByName[field.name] = row.id
      }
      await tx`
        insert into role_entity_permissions (role_id, entity_id, can_read, can_create, can_update, can_delete)
        values (${adminRole.id}, ${entity.id}, true, true, true, true)
      `
      entityByslug[def.slug] = { id: entity.id, fields: fieldsByName }
      console.log(`Módulo "${def.name}" (${def.slug}): ${def.fields.length} campos.`)
    }

    console.log('')
    console.log('Metadatos completos. Sembrando datos de ejemplo...')
    console.log('')

    // -------------------------------------------------------------------
    // Datos de ejemplo. Los montos/kilos son ilustrativos (pensados para
    // ejercitar agrupaciones, sumas y reparto en el diseñador de reportes
    // imprimibles, ERD-88) - NO estan reconciliados como un balance de masa
    // real (kilos recibidos != kilos empacados + merma exactos).

    async function seed(slug, rows) {
      const entity = entityByslug[slug]
      const ids = []
      for (const row of rows) {
        ids.push(await insertRecord(tx, tenantId, entity.id, row))
      }
      console.log(`${slug}: ${ids.length} registros`)
      return ids
    }

    const [prod1, prod2] = await seed('productores', [
      { nombre: 'Rancho Los Álamos', identificacion_fiscal: 'RAL850612AB3', contacto_nombre: 'Ignacio Salcido', telefono: '6671234567', email: 'contacto@rancholosalamos.mx', direccion: 'Carretera Culiacán-Navolato Km 12', municipio: 'Navolato', estado: 'Sinaloa', certificado_organico: false, activo: true },
      { nombre: 'Agrícola Vega Verde', identificacion_fiscal: 'AVV901203XY7', contacto_nombre: 'Rosa Elena Beltrán', telefono: '6679876543', email: 'administracion@vegaverde.mx', direccion: 'Km 8 Carretera a Costa Rica', municipio: 'Culiacán', estado: 'Sinaloa', certificado_organico: true, activo: true }
    ])

    const [fincaMirador, fincaSantaCruz, fincaOrganica] = await seed('fincas', [
      { nombre: 'Finca El Mirador', productor: prod1, hectareas: 45, tipo_riego: 'goteo', municipio: 'Navolato', certificacion_organica: false, altitud_msnm: 15, activa: true },
      { nombre: 'Finca Santa Cruz', productor: prod1, hectareas: 30, tipo_riego: 'aspersion', municipio: 'Navolato', certificacion_organica: false, altitud_msnm: 18, activa: true },
      { nombre: 'Finca Orgánica Vega Verde', productor: prod2, hectareas: 20, tipo_riego: 'goteo', municipio: 'Culiacán', certificacion_organica: true, altitud_msnm: 20, activa: true }
    ])

    const [espPimiento, espPepino, espTomate, espBerenjena] = await seed('especies', [
      { nombre: 'Pimiento', nombre_cientifico: 'Capsicum annuum', familia_botanica: 'Solanaceae', temporada: 'todo_el_ano', dias_promedio_cosecha: 75, unidad_cosecha: 'caja' },
      { nombre: 'Pepino', nombre_cientifico: 'Cucumis sativus', familia_botanica: 'Cucurbitaceae', temporada: 'todo_el_ano', dias_promedio_cosecha: 55, unidad_cosecha: 'caja' },
      { nombre: 'Tomate', nombre_cientifico: 'Solanum lycopersicum', familia_botanica: 'Solanaceae', temporada: 'todo_el_ano', dias_promedio_cosecha: 80, unidad_cosecha: 'caja' },
      { nombre: 'Berenjena', nombre_cientifico: 'Solanum melongena', familia_botanica: 'Solanaceae', temporada: 'todo_el_ano', dias_promedio_cosecha: 70, unidad_cosecha: 'caja' }
    ])

    const [varPimientoRojo, varPimientoAmarillo, varPimientoVerde, varPepinoConv, varPepinoOrg, varTomateCherry, varTomateHeirloom, varBerenjenaOrg] = await seed('variedades', [
      { nombre: 'Pimiento Rojo', especie: espPimiento, tipo_cultivo: 'convencional', color: 'rojo', dias_a_cosecha: 75, rendimiento_esperado_kg_ha: 45000, certificacion: 'ninguna', activo: true },
      { nombre: 'Pimiento Amarillo', especie: espPimiento, tipo_cultivo: 'convencional', color: 'amarillo', dias_a_cosecha: 78, rendimiento_esperado_kg_ha: 42000, certificacion: 'ninguna', activo: true },
      { nombre: 'Pimiento Verde', especie: espPimiento, tipo_cultivo: 'convencional', color: 'verde', dias_a_cosecha: 70, rendimiento_esperado_kg_ha: 48000, certificacion: 'ninguna', activo: true },
      { nombre: 'Pepino Persa Convencional', especie: espPepino, tipo_cultivo: 'convencional', color: 'verde', dias_a_cosecha: 50, rendimiento_esperado_kg_ha: 60000, certificacion: 'ninguna', activo: true },
      { nombre: 'Pepino Persa Orgánico', especie: espPepino, tipo_cultivo: 'organico', color: 'verde', dias_a_cosecha: 55, rendimiento_esperado_kg_ha: 38000, certificacion: 'senasica_organico', activo: true },
      { nombre: 'Tomate Cherry', especie: espTomate, tipo_cultivo: 'convencional', color: 'rojo', dias_a_cosecha: 65, rendimiento_esperado_kg_ha: 55000, certificacion: 'ninguna', activo: true },
      { nombre: 'Tomate Heirloom', especie: espTomate, tipo_cultivo: 'convencional', color: 'morado', dias_a_cosecha: 85, rendimiento_esperado_kg_ha: 30000, certificacion: 'ninguna', activo: true },
      { nombre: 'Berenjena Orgánica', especie: espBerenjena, tipo_cultivo: 'organico', color: 'morado', dias_a_cosecha: 75, rendimiento_esperado_kg_ha: 32000, certificacion: 'usda_organic', activo: true }
    ])

    const [clienteUS, clienteJP, clienteEU] = await seed('clientes', [
      { nombre: 'Fresh Produce Import LLC', pais: 'estados_unidos', ciudad: 'McAllen, TX', contacto_nombre: 'John Weaver', email: 'jweaver@freshproduceimport.com', telefono: '+19565551234', incoterm: 'fob', moneda: 'usd', activo: true },
      { nombre: 'Nagatomo Trading Co.', pais: 'japon', ciudad: 'Osaka', contacto_nombre: 'Kenji Nagatomo', email: 'k.nagatomo@nagatomotrading.jp', telefono: '+81665551234', incoterm: 'cif', moneda: 'usd', activo: true },
      { nombre: 'EuroVeg Distribution B.V.', pais: 'union_europea', ciudad: 'Rotterdam', contacto_nombre: 'Anke van Dijk', email: 'anke@euroveg.nl', telefono: '+31105551234', incoterm: 'dap', moneda: 'eur', activo: true }
    ])

    const [transPacifico, fletesCuliacan] = await seed('transportistas', [
      { nombre: 'Autotransportes del Pacífico', rfc: 'ATP870512AB1', telefono: '6671112233', tipo_servicio: 'internacional', numero_permiso_sct: 'SCT-458712', activo: true },
      { nombre: 'Fletes Culiacán', rfc: 'FCU920815XZ9', telefono: '6674445566', tipo_servicio: 'local', numero_permiso_sct: 'SCT-1029384', activo: true }
    ])

    const [vehiculo1, vehiculo2, vehiculo3] = await seed('vehiculos', [
      { placa: 'SL-45-021', transportista: transPacifico, tipo: 'refrigerado', capacidad_kg: 28000, marca: 'Freightliner', modelo: 'Cascadia', anio: 2021, activo: true },
      { placa: 'SL-32-987', transportista: transPacifico, tipo: 'refrigerado', capacidad_kg: 26000, marca: 'Kenworth', modelo: 'T680', anio: 2019, activo: true },
      { placa: 'SL-11-456', transportista: fletesCuliacan, tipo: 'seco', capacidad_kg: 18000, marca: 'International', modelo: 'DuraStar', anio: 2018, activo: true }
    ])

    const [choferRamon, choferFidel, choferGuadalupe] = await seed('choferes', [
      { nombre: 'Ramón Osuna Beltrán', transportista: transPacifico, licencia: 'SIN-4589012', telefono: '6671230099', vencimiento_licencia: '2027-05-20', activo: true },
      { nombre: 'Fidel Armenta López', transportista: transPacifico, licencia: 'SIN-3321087', telefono: '6671230100', vencimiento_licencia: '2026-11-10', activo: true },
      { nombre: 'Guadalupe Ibarra Cota', transportista: fletesCuliacan, licencia: 'SIN-7789456', telefono: '6671230101', vencimiento_licencia: '2028-01-15', activo: true }
    ])

    const [camara1, camara2] = await seed('camaras_frio', [
      { nombre: 'Cámara 1 - Convencionales', temperatura_objetivo_c: 7, humedad_objetivo_pct: 90, capacidad_pallets: 40, ubicacion: 'Nave A', activa: true },
      { nombre: 'Cámara 2 - Orgánicos', temperatura_objetivo_c: 6, humedad_objetivo_pct: 92, capacidad_pallets: 25, ubicacion: 'Nave B', activa: true }
    ])

    const [presCaja10, presClamshell, presCaja5] = await seed('presentaciones', [
      { nombre: 'Caja 10kg Granel', capacidad_kg: 10, unidades_por_caja: 1, material: 'carton', reciclable: true, activo: true },
      { nombre: 'Clamshell 12x170g', capacidad_kg: 2.04, unidades_por_caja: 12, material: 'plastico', reciclable: false, activo: true },
      { nombre: 'Caja 5kg Premium', capacidad_kg: 5, unidades_por_caja: 1, material: 'carton', reciclable: true, activo: true }
    ])

    // ---- Palets: folio via incremental real (nextFolio) ----
    const paletsEntity = entityByslug.palets
    async function seedPalet(data) {
      const folio = await nextFolio(tx, paletsEntity.fields.folio, 5)
      return insertRecord(tx, tenantId, paletsEntity.id, { folio, ...data })
    }
    const palet1 = await seedPalet({ camara: camara1, fecha_ingreso: '2026-08-20', estado: 'despachado', cantidad_cajas: 460, kilos_totales: 3700, observaciones: '' })
    const palet2 = await seedPalet({ camara: camara1, fecha_ingreso: '2026-08-21', estado: 'despachado', cantidad_cajas: 260, kilos_totales: 2600, observaciones: '' })
    const palet3 = await seedPalet({ camara: camara2, fecha_ingreso: '2026-08-22', estado: 'despachado', cantidad_cajas: 460, kilos_totales: 3200, observaciones: 'Lote orgánico certificado' })
    const palet4 = await seedPalet({ camara: camara1, fecha_ingreso: '2026-08-23', estado: 'despachado', cantidad_cajas: 390, kilos_totales: 3900, observaciones: '' })
    const palet5 = await seedPalet({ camara: camara2, fecha_ingreso: '2026-08-24', estado: 'reservado', cantidad_cajas: 60, kilos_totales: 300, observaciones: 'Pendiente de asignar a embarque' })
    console.log('palets: 5 registros')

    // ---- Recepciones: folio via incremental real ----
    const recepcionesEntity = entityByslug.recepciones
    async function seedRecepcion(data) {
      const folio = await nextFolio(tx, recepcionesEntity.fields.folio, 6)
      return insertRecord(tx, tenantId, recepcionesEntity.id, { folio, ...data })
    }
    const rec1 = await seedRecepcion({ fecha: '2026-08-18', finca: fincaMirador, variedad: varPimientoRojo, chofer: choferRamon, vehiculo: vehiculo1, kilos_recibidos: 5200, temperatura_recepcion_c: 12, lote_campo: 'LC-0818-A', calidad_visual: 'excelente', observaciones: '' })
    const rec2 = await seedRecepcion({ fecha: '2026-08-18', finca: fincaSantaCruz, variedad: varPimientoAmarillo, chofer: choferFidel, vehiculo: vehiculo2, kilos_recibidos: 3100, temperatura_recepcion_c: 13, lote_campo: 'LC-0818-B', calidad_visual: 'buena', observaciones: '' })
    const rec3 = await seedRecepcion({ fecha: '2026-08-19', finca: fincaMirador, variedad: varPimientoVerde, chofer: choferRamon, vehiculo: vehiculo1, kilos_recibidos: 4800, temperatura_recepcion_c: 11, lote_campo: 'LC-0819-A', calidad_visual: 'excelente', observaciones: '' })
    const rec4 = await seedRecepcion({ fecha: '2026-08-19', finca: fincaSantaCruz, variedad: varPepinoConv, chofer: choferFidel, vehiculo: vehiculo2, kilos_recibidos: 3900, temperatura_recepcion_c: 12, lote_campo: 'LC-0819-B', calidad_visual: 'buena', observaciones: '' })
    const rec5 = await seedRecepcion({ fecha: '2026-08-20', finca: fincaOrganica, variedad: varPepinoOrg, chofer: choferGuadalupe, vehiculo: vehiculo3, kilos_recibidos: 2100, temperatura_recepcion_c: 10, lote_campo: 'LC-0820-A', calidad_visual: 'excelente', observaciones: '' })
    const rec6 = await seedRecepcion({ fecha: '2026-08-20', finca: fincaOrganica, variedad: varTomateCherry, chofer: choferGuadalupe, vehiculo: vehiculo3, kilos_recibidos: 1800, temperatura_recepcion_c: 9, lote_campo: 'LC-0820-B', calidad_visual: 'excelente', observaciones: '' })
    const rec7 = await seedRecepcion({ fecha: '2026-08-21', finca: fincaSantaCruz, variedad: varTomateHeirloom, chofer: choferFidel, vehiculo: vehiculo2, kilos_recibidos: 1200, temperatura_recepcion_c: 11, lote_campo: 'LC-0821-A', calidad_visual: 'buena', observaciones: '' })
    const rec8 = await seedRecepcion({ fecha: '2026-08-21', finca: fincaOrganica, variedad: varBerenjenaOrg, chofer: choferGuadalupe, vehiculo: vehiculo3, kilos_recibidos: 1500, temperatura_recepcion_c: 10, lote_campo: 'LC-0821-B', calidad_visual: 'excelente', observaciones: '' })
    console.log('recepciones: 8 registros')

    // ---- Empaques: folio via incremental real ----
    const empaquesEntity = entityByslug.empaques
    async function seedEmpaque(data) {
      const folio = await nextFolio(tx, empaquesEntity.fields.folio, 6)
      return insertRecord(tx, tenantId, empaquesEntity.id, { folio, ...data })
    }
    await seedEmpaque({ fecha: '2026-08-19', recepcion: rec1, presentacion: presCaja10, categoria: 'extra', calibre: 'L', kilos_empacados: 2800, cajas_producidas: 280, kilos_merma: 120, camara: camara1, palet: palet1 })
    await seedEmpaque({ fecha: '2026-08-19', recepcion: rec1, presentacion: presCaja5, categoria: 'primera', calibre: 'M', kilos_empacados: 900, cajas_producidas: 180, kilos_merma: 40, camara: camara1, palet: palet1 })
    await seedEmpaque({ fecha: '2026-08-19', recepcion: rec2, presentacion: presCaja10, categoria: 'primera', calibre: 'M', kilos_empacados: 2600, cajas_producidas: 260, kilos_merma: 90, camara: camara1, palet: palet2 })
    await seedEmpaque({ fecha: '2026-08-20', recepcion: rec3, presentacion: presCaja10, categoria: 'extra', calibre: 'L', kilos_empacados: 3900, cajas_producidas: 390, kilos_merma: 130, camara: camara1, palet: palet4 })
    await seedEmpaque({ fecha: '2026-08-20', recepcion: rec4, presentacion: presClamshell, categoria: 'extra', calibre: 'Único', kilos_empacados: 3200, cajas_producidas: 1568, kilos_merma: 100, camara: camara1, palet: null })
    await seedEmpaque({ fecha: '2026-08-21', recepcion: rec5, presentacion: presCaja10, categoria: 'extra', calibre: 'M', kilos_empacados: 1800, cajas_producidas: 180, kilos_merma: 60, camara: camara2, palet: palet3 })
    await seedEmpaque({ fecha: '2026-08-21', recepcion: rec6, presentacion: presCaja5, categoria: 'extra', calibre: 'S', kilos_empacados: 1400, cajas_producidas: 280, kilos_merma: 50, camara: camara2, palet: palet3 })
    await seedEmpaque({ fecha: '2026-08-21', recepcion: rec6, presentacion: presClamshell, categoria: 'primera', calibre: 'Único', kilos_empacados: 300, cajas_producidas: 147, kilos_merma: 20, camara: camara2, palet: null })
    await seedEmpaque({ fecha: '2026-08-22', recepcion: rec7, presentacion: presCaja5, categoria: 'primera', calibre: 'M', kilos_empacados: 900, cajas_producidas: 180, kilos_merma: 40, camara: camara1, palet: palet5 })
    await seedEmpaque({ fecha: '2026-08-22', recepcion: rec8, presentacion: presCaja10, categoria: 'extra', calibre: 'M', kilos_empacados: 1300, cajas_producidas: 130, kilos_merma: 50, camara: camara2, palet: palet5 })
    console.log('empaques: 10 registros')

    // ---- Embarques: folio via incremental real ----
    const embarquesEntity = entityByslug.embarques
    async function seedEmbarque(data) {
      const folio = await nextFolio(tx, embarquesEntity.fields.folio, 5)
      return insertRecord(tx, tenantId, embarquesEntity.id, { folio, ...data })
    }
    const emb1 = await seedEmbarque({ fecha_salida: '2026-08-25', cliente: clienteUS, transportista: transPacifico, chofer: choferRamon, contenedor: 'MSCU1234567', sello_seguridad: 'SEC-98213', temperatura_transporte_c: 6, fecha_estimada_llegada: '2026-08-27', estado: 'en_transito', observaciones: 'Contenedor mixto pimientos y pepino' })
    const emb2 = await seedEmbarque({ fecha_salida: '2026-08-26', cliente: clienteJP, transportista: transPacifico, chofer: choferFidel, contenedor: 'TCLU7654321', sello_seguridad: 'SEC-98214', temperatura_transporte_c: 5, fecha_estimada_llegada: '2026-09-15', estado: 'programado', observaciones: 'Exportación vía puerto de Manzanillo' })
    const emb3 = await seedEmbarque({ fecha_salida: '2026-08-24', cliente: clienteEU, transportista: fletesCuliacan, chofer: choferGuadalupe, contenedor: 'HLXU3216549', sello_seguridad: 'SEC-98150', temperatura_transporte_c: 7, fecha_estimada_llegada: '2026-09-10', estado: 'entregado', observaciones: 'Certificado orgánico adjunto' })
    console.log('embarques: 3 registros')

    // ---- Detalle de embarques (la "tabla relacionada" 1:N usada por ERD-88) ----
    await seed('detalle_embarques', [
      { embarque: emb1, palet: palet1, cajas: 460, kilos: 3700, precio_unitario_usd: 8.5, importe_usd: 3910 },
      { embarque: emb1, palet: palet2, cajas: 260, kilos: 2600, precio_unitario_usd: 8.2, importe_usd: 2132 },
      { embarque: emb3, palet: palet3, cajas: 460, kilos: 3200, precio_unitario_usd: 11.0, importe_usd: 5060 },
      { embarque: emb2, palet: palet4, cajas: 390, kilos: 3900, precio_unitario_usd: 7.8, importe_usd: 3042 }
    ])
    // palet5 queda "reservado", sin aparecer en ningun embarque todavia -
    // a proposito, para poder probar en el reporte imprimible el caso de un
    // grupo sin filas de detalle.
  })

  console.log('')
  console.log('Seed completo.')
  console.log('')
  console.log('  Organización:  ', ORG_NAME)
  console.log('  Usuario:       ', PERSON_NAME, `<${PERSON_EMAIL}>`)
  console.log('  Contraseña:    ', PERSON_PASSWORD)
} finally {
  await sql.end()
}
