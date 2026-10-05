import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it } from 'vitest'

function customFunctionSettings(sql: string) {
  const withoutComments = sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, '')
  const headers = [...withoutComments.matchAll(/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b[\s\S]*?\bAS\s+(?=\$[\w]*\$|')/gi)]
  return headers.flatMap(header => [...header[0].matchAll(/\bSET\s+(?:"?(?:app|flow)"?)\s*\.\s*"?\w+"?/gi)].map(setting => setting[0]))
}

it('detecta SET app./flow. en cabeceras, sin confundir set_config ni el cuerpo', () => {
  expect(customFunctionSettings(`CREATE OR REPLACE FUNCTION x() RETURNS void
    LANGUAGE plpgsql SET APP.tenant_id = 'x' SET flow.x TO 'on' AS $$ BEGIN NULL; END $$;`)).toEqual(['SET APP.tenant_id', 'SET flow.x'])
  expect(customFunctionSettings(`CREATE FUNCTION x() RETURNS void
    LANGUAGE plpgsql SET search_path = public AS $$ BEGIN PERFORM set_config('app.x', 'on', true); END $$;`)).toEqual([])
})

it('ninguna migración declara parámetros personalizados en CREATE FUNCTION', () => {
  const directory = resolve(__dirname, '../../server/db/migrations')
  const violations = readdirSync(directory).filter(file => file.endsWith('.sql')).sort()
    .flatMap(file => customFunctionSettings(readFileSync(resolve(directory, file), 'utf8')).map(setting => `${file}: ${setting}`))
  expect(violations).toEqual([])
})
