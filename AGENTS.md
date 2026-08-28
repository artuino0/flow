# erp-dinamico-frontback

Nuxt 3 (Vue + Composition API) con el motor Nitro integrado como backend (API, validaciones,
auth). Ver arquitectura completa en `DOCS/Motor_ERP_Dinamico_v1.1.docx` (repo de documentacion
del proyecto, Jira: proyecto ERD).

Repo hermano: `erp-dinamico-database` (contenedor PostgreSQL, puerto 5433).

## Uso local

```
docker network create erp-dinamico-net   # una sola vez, si no existe ya
cp .env.example .env
npm install
npm run dev
```

## Flujo Git
- rama_base: main
- patron_rama: {TIPO}-{ID}
- tipo_bug: BUG
- tipo_feature: HU
- url_ticket: https://dydasoftware.atlassian.net/browse/{ID}
- bump: PATCH si bug, MINOR si feature
- push_flags: (ninguno)
