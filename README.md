# erp-dinamico-frontback

Nuxt 3 + Nitro (frontend y backend integrados) para el Motor Flow.

## Requisitos
- Node 22+
- Docker + Docker Compose v2 (opcional, para correr en contenedor)

## Desarrollo local

```bash
cp .env.example .env
npm install
npm run dev
```

Health check: `GET /api/health`

## Contenedor

```bash
docker network create erp-dinamico-net   # solo la primera vez
docker compose up -d --build
```

Requiere que `erp-dinamico-database` este corriendo en la misma red `erp-dinamico-net`
(el contenedor de la app la resuelve por el nombre `erp-dinamico-db`).

## Flujo Git
Ver `AGENTS.md`.
