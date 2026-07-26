# K95 Sales — React (Vite)

Modern frontend for the K95 sales system. The first migrated screen is the **Order Form** (`/orders`).

## Setup

```bash
cd web
cp .env.example .env.local
```

Edit `.env.local` with your Supabase project URL and anon key (same values as the legacy `config.js`).

If you deploy behind the PHP proxy (like the old app), set:

```
VITE_API_PROXY=/salesk95/proxy.php
```

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:5173 — sign in with your Supabase Auth email/password, then use the order form.

## Routes

| Path | Screen |
|------|--------|
| `/login` | Supabase email/password sign-in |
| `/orders` | Sales order form (protected) |

## Order form UI versions

| Version | Location | Description |
|---------|----------|-------------|
| **V1** | `backups/order-form-v1/` | Original clean light theme |
| **V2** | `src/features/orders/` (live) + `backups/order-form-v2/` | Adaptive light/dark, submit progress, no top KPI strip |

Restore instructions: `backups/order-form-v1/README.md` and `backups/order-form-v2/README.md`.

## Legacy app

The original HTML/PHP app remains in the parent folder (`order/`, `index.html`, etc.) and is unchanged. Run this React app in parallel until other modules are migrated.

## Build for production

```bash
npm run build
```

Output is in `web/dist/`. Serve with any static host or reverse-proxy to `/salesk95/` as needed.
