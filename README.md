# Nineton
Facebook Auto post

## Supabase setup

1. Create a Supabase project.
2. Open the SQL editor and run `supabase.schema.sql`.
3. Set these environment variables on Render:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Keep the existing app keys as needed:
   - `GEMINI_API_KEY`
   - `FB_PAGE_ID`
   - `FB_TOKEN`

If Supabase env vars are not set, the app falls back to local JSON files.
