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

### Correo local con Mailpit

Mailpit recibe correos de prueba en `localhost:1025` y muestra la bandeja en
<http://localhost:8025>. No entrega mensajes a destinatarios reales.

```bash
docker network create erp-dinamico-net  # solo si aún no existe
docker run -d --name erp-dinamico-mailpit --restart unless-stopped --network erp-dinamico-net -p 1025:1025 -p 8025:8025 axllent/mailpit
```

Si el contenedor ya existe, usa `docker start erp-dinamico-mailpit`. En `.env`
usa `SMTP_HOST=localhost`, `SMTP_PORT=1025`, `SMTP_FROM="Flow <no-responder@flow.local>"`
y `APP_BASE_URL=http://localhost:3000`; deja `SMTP_USER` y `SMTP_PASSWORD` vacíos
o elimínalos. Reinicia `npm run dev` después de cambiar `.env`.

## Contenedor

```bash
docker network create erp-dinamico-net   # solo la primera vez
docker compose up -d --build
```

Requiere que `erp-dinamico-database` este corriendo en la misma red `erp-dinamico-net`
(el contenedor de la app la resuelve por el nombre `erp-dinamico-db`).

## Flujo Git
Ver `AGENTS.md`.
