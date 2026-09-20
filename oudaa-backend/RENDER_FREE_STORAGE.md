# Render Free storage setup

Oudaa does not require a Render persistent disk. Render Free web services have an ephemeral filesystem, so platform export files are stored in Supabase Storage instead.

## Supabase
1. Open the Oudaa Supabase project.
2. Go to Storage and create a bucket named `platform-exports`.
3. Keep the bucket private.
4. In Render, set:

```text
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_RECEIPTS_BUCKET=receipts
SUPABASE_EXPORTS_BUCKET=platform-exports
```

The backend creates export jobs in Postgres, uploads the finished CSV/XLSX/JSON file to Supabase Storage, and generates a short-lived signed URL only when an authorized platform admin downloads it.
