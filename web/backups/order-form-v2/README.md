# Order Form — V2

Backup of the live order form UI (no top KPI strip).

## Includes

- `OrderFormPage.tsx` / `OrderFormPage.css` — adaptive light/dark theme, submit progress overlay, summary mini metrics (Drop Size / Qty / Amount)
- `useSubmitProgress.ts` — submit progress bar hook

## Restore V2

Copy into `web/src/features/orders/`:

```bash
cp backups/order-form-v2/OrderFormPage.tsx src/features/orders/
cp backups/order-form-v2/OrderFormPage.css src/features/orders/
cp backups/order-form-v2/useSubmitProgress.ts src/features/orders/
```

## Other versions

| Version | Folder |
|---------|--------|
| V1 | `backups/order-form-v1/` — original light theme |
