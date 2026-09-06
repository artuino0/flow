import { isNull } from 'drizzle-orm'
import { records } from '~/server/db/schema'

// ERD-87 (borrado logico): condicion compartida por todo endpoint/utilidad
// que lee records para uso NORMAL de la plataforma (listado, detalle,
// edicion, busqueda de relacion en import CSV, ETL de OLAP, conteo de
// registros de un modulo) - un registro con deletedAt seteado es "papelera",
// invisible por defecto en todos esos caminos, exactamente como si siguiera
// borrado de verdad.
//
// server/utils/relationLabels.ts, server/utils/triggerActions.ts y la
// busqueda del registro relacionado en server/utils/incrementalField.ts
// deliberadamente NO usan este helper: resuelven un id YA CONOCIDO (una
// relacion guardada, un job de trigger ya encolado) y tienen que seguir
// funcionando aunque ese registro puntual haya sido eliminado despues -
// nunca listan ni buscan registros "al azar" dentro de una entidad, que es el
// caso que este filtro previene.
//
// El Diseñador de reportes imprimibles (ERD-88) es el UNICO consumidor que
// necesita poder pasar por alto este filtro (toggle "Incluir registros
// eliminados"): arma su propio WHERE sin este helper cuando esa opcion esta
// activa, en vez de reusarlo.
export const recordNotDeleted = isNull(records.deletedAt)
