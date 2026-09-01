import { alias } from 'drizzle-orm/pg-core'
import { and, count, eq, or } from 'drizzle-orm'
import { db, withTenant } from '~/server/db'
import { entities, recordRelations, relationDefinitions } from '~/server/db/schema'

// HU-ERD-77: administracion de relation_definitions (el mecanismo de grafo
// generico de ERD-10/19) - hasta esta HU, en NINGUN punto del codigo existia
// una forma de insertar una fila en relation_definitions (ni endpoint ni
// script): POST /api/relations (ERD-19) siempre esperaba recibir un
// relationDefinitionId YA EXISTENTE, sin decir de donde saldria. Documentado
// primero como brecha real en DOCS/Flujo_Recepcion_Empaque_Embarque.md
// (v0.48.0, que tuvo que modelarse con campos `relation` simples en su lugar
// por esto mismo) y formalizado como ticket propio tras la revision "que le
// falta a la plataforma" de esta sesion (2026-09-01).
//
// Mismo patron que moduleEntities.ts (HU-ERD-66): logica separada de los
// endpoints para poder testearla sin HTTP, admin-only (mismo criterio que
// crear/editar un modulo - definir que TIPOS de relacion existen es
// configuracion de la plataforma, no una accion de uso diario; crear
// INSTANCIAS del vinculo - POST /api/relations - sigue siendo por permiso
// canUpdate de ambas entidades, sin cambios).

type Tx = typeof db

const PG_UNIQUE_VIOLATION = '23505'

export class DuplicateRelationNameError extends Error {}
// "RelationEntityNotFoundError", no "EntityNotFoundError": ese nombre ya lo
// exporta moduleEntityFields.ts (HU-ERD-67) - Nuxt auto-importa server/utils/*
// por nombre exportado, y dos clases con el mismo nombre en dos archivos
// distintos colisionan (una pisa a la otra en el auto-import, sin error de
// build - se vio como un WARN de "Duplicated imports" al typecheckear). Nunca
// reusar un nombre de clase de error ya exportado por otro server/utils/*.
export class RelationEntityNotFoundError extends Error {}

export interface RelationDefinitionItem {
  id: string
  name: string
  sourceEntityId: string
  sourceEntitySlug: string
  sourceEntityName: string
  targetEntityId: string
  targetEntitySlug: string
  targetEntityName: string
  createdAt: Date
  // Cantidad de record_relations que ya usan esta definicion - lo que
  // bloquea el borrado (ver deleteRelationDefinition) y lo que la pantalla
  // de administracion muestra para que no sea sorpresa por que no se puede
  // eliminar una definicion en uso.
  linkCount: number
}

async function assertEntityInTenant(tx: Tx, tenantId: string, entityId: string): Promise<void> {
  const [row] = await tx.select({ id: entities.id }).from(entities).where(and(eq(entities.id, entityId), eq(entities.tenantId, tenantId))).limit(1)
  if (!row) throw new RelationEntityNotFoundError(`La entidad ${entityId} no existe en este tenant`)
}

function pgErrorCode(err: unknown): string | undefined {
  return (err as { code?: string; cause?: { code?: string } })?.code ?? (err as { cause?: { code?: string } })?.cause?.code
}

/**
 * Lista relation_definitions del tenant, con los nombres de las entidades
 * origen/destino ya resueltos (self-join via alias(), una definicion NO
 * excluye origen=destino - una relacion jerarquica de una entidad consigo
 * misma, ej. "Empresa matriz de Empresa", es un caso legitimo) y la cantidad
 * de record_relations que ya la usan. `entityId` (opcional) filtra a las
 * que involucran esa entidad como origen O destino - es lo que consume la
 * pestaña "Relaciones" de Editar Módulo (una entidad puntual); sin el filtro
 * sirve igual para un futuro listado global.
 */
export async function listRelationDefinitions(tenantId: string, entityId?: string): Promise<RelationDefinitionItem[]> {
  const sourceEntities = alias(entities, 'source_entities')
  const targetEntities = alias(entities, 'target_entities')

  return withTenant(tenantId, async (tx) => {
    const conditions = [eq(relationDefinitions.tenantId, tenantId)]
    if (entityId) {
      conditions.push(or(eq(relationDefinitions.sourceEntityId, entityId), eq(relationDefinitions.targetEntityId, entityId))!)
    }

    const rows = await tx
      .select({
        id: relationDefinitions.id,
        name: relationDefinitions.name,
        sourceEntityId: relationDefinitions.sourceEntityId,
        sourceEntitySlug: sourceEntities.slug,
        sourceEntityName: sourceEntities.name,
        targetEntityId: relationDefinitions.targetEntityId,
        targetEntitySlug: targetEntities.slug,
        targetEntityName: targetEntities.name,
        createdAt: relationDefinitions.createdAt
      })
      .from(relationDefinitions)
      .innerJoin(sourceEntities, eq(sourceEntities.id, relationDefinitions.sourceEntityId))
      .innerJoin(targetEntities, eq(targetEntities.id, relationDefinitions.targetEntityId))
      .where(and(...conditions))
      .orderBy(relationDefinitions.name)

    if (rows.length === 0) return []

    const linkRows = await tx
      .select({ relationDefinitionId: recordRelations.relationDefinitionId, value: count() })
      .from(recordRelations)
      .where(eq(recordRelations.tenantId, tenantId))
      .groupBy(recordRelations.relationDefinitionId)
    const linkCountByDefinition = new Map(linkRows.map((r) => [r.relationDefinitionId, r.value]))

    return rows.map((r) => ({ ...r, linkCount: linkCountByDefinition.get(r.id) ?? 0 }))
  })
}

/**
 * Crea una relation_definition. Ambas entidades deben existir en el tenant
 * (EntityNotFoundError si no) - se valida ANTES del insert para no depender
 * del error de foreign key crudo de Postgres. Nombre duplicado dentro del
 * mismo tenant -> DuplicateRelationNameError (mismo patron de traduccion de
 * unique_violation que DuplicateSlugError en moduleEntities.ts).
 */
export async function createRelationDefinition(
  tenantId: string,
  input: { name: string; sourceEntityId: string; targetEntityId: string }
): Promise<RelationDefinitionItem> {
  return withTenant(tenantId, async (tx) => {
    await assertEntityInTenant(tx, tenantId, input.sourceEntityId)
    await assertEntityInTenant(tx, tenantId, input.targetEntityId)

    let created: typeof relationDefinitions.$inferSelect
    try {
      ;[created] = await tx
        .insert(relationDefinitions)
        .values({ tenantId, name: input.name, sourceEntityId: input.sourceEntityId, targetEntityId: input.targetEntityId })
        .returning()
    } catch (err) {
      if (pgErrorCode(err) === PG_UNIQUE_VIOLATION) {
        throw new DuplicateRelationNameError(`Ya existe una relacion llamada "${input.name}"`)
      }
      throw err
    }

    const [source] = await tx.select({ slug: entities.slug, name: entities.name }).from(entities).where(eq(entities.id, created.sourceEntityId)).limit(1)
    const [target] = await tx.select({ slug: entities.slug, name: entities.name }).from(entities).where(eq(entities.id, created.targetEntityId)).limit(1)

    return {
      id: created.id,
      name: created.name,
      sourceEntityId: created.sourceEntityId,
      sourceEntitySlug: source.slug,
      sourceEntityName: source.name,
      targetEntityId: created.targetEntityId,
      targetEntitySlug: target.slug,
      targetEntityName: target.name,
      createdAt: created.createdAt,
      linkCount: 0
    }
  })
}

/**
 * Renombra una relation_definition existente. Deliberadamente NO permite
 * cambiar sourceEntityId/targetEntityId despues de creada: el trigger de
 * integridad (fn_validate_record_relation, ERD-10) valida el TIPO de cada
 * record_relation contra la definicion en el momento en que ese vinculo se
 * crea, no de forma continua - cambiar a que entidades apunta una definicion
 * ya usada dejaria record_relations viejos "mintiendo" sobre su propio tipo,
 * sin que nada lo detecte. Si el tipo de relacion esta mal, el camino
 * correcto es borrarla (bloqueado mientras tenga vinculos, ver
 * deleteRelationDefinition) y crear una nueva.
 */
export async function updateRelationDefinition(tenantId: string, id: string, input: { name: string }): Promise<RelationDefinitionItem | null> {
  return withTenant(tenantId, async (tx) => {
    let updated: typeof relationDefinitions.$inferSelect | undefined
    try {
      ;[updated] = await tx
        .update(relationDefinitions)
        .set({ name: input.name })
        .where(and(eq(relationDefinitions.id, id), eq(relationDefinitions.tenantId, tenantId)))
        .returning()
    } catch (err) {
      if (pgErrorCode(err) === PG_UNIQUE_VIOLATION) {
        throw new DuplicateRelationNameError(`Ya existe una relacion llamada "${input.name}"`)
      }
      throw err
    }
    if (!updated) return null

    const [source] = await tx.select({ slug: entities.slug, name: entities.name }).from(entities).where(eq(entities.id, updated.sourceEntityId)).limit(1)
    const [target] = await tx.select({ slug: entities.slug, name: entities.name }).from(entities).where(eq(entities.id, updated.targetEntityId)).limit(1)
    const [{ value: linkCount }] = await tx
      .select({ value: count() })
      .from(recordRelations)
      .where(and(eq(recordRelations.tenantId, tenantId), eq(recordRelations.relationDefinitionId, id)))

    return {
      id: updated.id,
      name: updated.name,
      sourceEntityId: updated.sourceEntityId,
      sourceEntitySlug: source.slug,
      sourceEntityName: source.name,
      targetEntityId: updated.targetEntityId,
      targetEntitySlug: target.slug,
      targetEntityName: target.name,
      createdAt: updated.createdAt,
      linkCount
    }
  })
}

export type DeleteRelationDefinitionResult = { status: 'deleted' } | { status: 'has-links'; linkCount: number } | { status: 'not-found' }

/**
 * Elimina una relation_definition. Bloqueada si ya tiene record_relations
 * (aunque la FK tiene ON DELETE CASCADE a nivel de base, HU-ERD-10) - mismo
 * criterio de proteccion de datos que deleteEntity() en moduleEntities.ts:
 * nunca borrar vinculos ya creados por el usuario en cascada sin que lo pida
 * explicitamente borrando cada uno primero.
 */
export async function deleteRelationDefinition(tenantId: string, id: string): Promise<DeleteRelationDefinitionResult> {
  return withTenant(tenantId, async (tx: Tx) => {
    const [definition] = await tx
      .select({ id: relationDefinitions.id })
      .from(relationDefinitions)
      .where(and(eq(relationDefinitions.id, id), eq(relationDefinitions.tenantId, tenantId)))
      .limit(1)
    if (!definition) return { status: 'not-found' }

    const [{ value: linkCount }] = await tx
      .select({ value: count() })
      .from(recordRelations)
      .where(and(eq(recordRelations.tenantId, tenantId), eq(recordRelations.relationDefinitionId, id)))

    if (linkCount > 0) return { status: 'has-links', linkCount }

    await tx.delete(relationDefinitions).where(and(eq(relationDefinitions.id, id), eq(relationDefinitions.tenantId, tenantId)))
    return { status: 'deleted' }
  })
}
