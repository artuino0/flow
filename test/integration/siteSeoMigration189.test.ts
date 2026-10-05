import { expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import postgres from 'postgres'
import { createTestDb } from '../setup/testDb'
it('0097 congela el SEO publicado antiguo como propietario no superusuario, con ACL cerrada', async () => {
  const database = await createTestDb({ throughMigration: '0096_platform_crm.sql' })
  const owner = postgres(database.ownerUrl, { max: 1, onnotice: () => {} }), app = postgres(database.appUrl, { max: 1, onnotice: () => {} })
  try {
    const tenant = randomUUID(), site = randomUUID(), page = randomUUID(), version = randomUUID()
    expect((await owner`select current_setting('is_superuser') as value`)[0]!.value).toBe('off')
    await owner`insert into tenants(id,name,slug) values (${tenant},'Migración SEO',${tenant})`
    await owner`insert into sites(id,tenant_id,name,slug,status) values (${site},${tenant},'Sitio','sitio','published')`
    await owner`insert into site_pages(id,tenant_id,site_id,title,path,status,seo,published_version_id) values (${page},${tenant},${site},'Inicio','/','published','{"title":"Título antiguo","old":true}',${version})`
    await owner`insert into site_page_versions(id,tenant_id,site_id,page_id,version,status,html) values (${version},${tenant},${site},${page},1,'published','<h1>Antiguo</h1>')`
    await owner`insert into site_domains(tenant_id,site_id,hostname,status) values (${tenant},${site},'migracion189.test','active')`
    const migration = readFileSync('server/db/migrations/0097_sites_seo.sql', 'utf8')
    expect(migration).not.toMatch(/SET\s+(?:app|flow)\./i)
    await owner.begin(async tx => { await tx.unsafe(migration) })
    await owner`update site_pages set seo='{"title":"Borrador nuevo"}' where id=${page}`
    expect((await app`select * from resolve_published_site_domain('migracion189.test','/')`)[0]!.seo).toEqual({ title: 'Título antiguo', old: true })
    for (const name of ['public_site_seo_context', 'public_site_sitemap', 'public_site_seo_image']) {
      const [fn] = await owner`select pg_get_userbyid(proowner) as owner,proconfig,proacl::text as acl from pg_proc where proname=${name}`
      expect(fn!.owner).toBe('erp_owner'); expect(fn!.proconfig).toEqual(['search_path=public']); expect(fn!.acl).toContain('erp_app=X'); expect(fn!.acl).not.toMatch(/[{,]=X/)
    }
    expect(await app`select * from public_site_seo_context('desconocido189.test')`).toHaveLength(0)
    expect(await app`select * from public_site_sitemap('migracion189.test')`).toHaveLength(1)
    await owner`update sites set status='draft' where id=${site}`
    expect(await app`select * from public_site_sitemap('migracion189.test')`).toHaveLength(0)
  } finally { await app.end(); await owner.end(); await database.stop() }
}, 120000)
