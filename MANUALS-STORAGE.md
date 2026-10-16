# Machine manuals in Supabase Storage (v1.8.7) - SQL to run (NOT applied)

The app keeps machine manual PDFs in a **private** Storage bucket `cg-manuals`, one folder per machine id:
`cg-manuals/<machine id>/<file name>.pdf` (e.g. `tos-fo10-diff/FO10 manual.pdf`). Until the bucket exists
the app keeps manuals in each browser's IndexedDB as before and says so on the machine page.

The Supabase project belongs to **QC Form**, so this must be run by its owner in the SQL editor
(Dashboard -> SQL). It only adds one bucket and four policies on `storage.objects` for that bucket;
no other table or bucket is touched. It relies on the existing `public.cg_can_view()` / `public.cg_can_edit()`
functions the app already calls (security definer, based on the signed-in user's cg role).

```sql
-- 1. private bucket, PDFs only, 50 MB max per file
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cg-manuals', 'cg-manuals', false, 52428800, array['application/pdf'])
on conflict (id) do nothing;

-- 2. read: signed-in users with cg view rights (viewer, admin)
create policy "cg-manuals read" on storage.objects
  for select to authenticated
  using (bucket_id = 'cg-manuals' and public.cg_can_view());

-- 3. upload / replace / remove: cg editors (admin)
create policy "cg-manuals insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'cg-manuals' and public.cg_can_edit());

create policy "cg-manuals update" on storage.objects
  for update to authenticated
  using (bucket_id = 'cg-manuals' and public.cg_can_edit())
  with check (bucket_id = 'cg-manuals' and public.cg_can_edit());

create policy "cg-manuals delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'cg-manuals' and public.cg_can_edit());
```

Notes
- Upload uses `upsert: true` (replace), which needs both the insert and the update policy.
- Anonymous visitors (publishable key, not signed in) get nothing: no policy grants `anon`.
- To undo: `drop policy "cg-manuals read" on storage.objects;` (and the other three), then delete the bucket
  from Dashboard -> Storage (it must be empty).
- After running it: sign in as admin, open Data (Import / export) -> "Upload manuals to shared storage" on the PC
  that has the manuals, or "Upload to shared storage" on each machine page.

Read-only check done on 2026-10-16 with the publishable key: `GET /storage/v1/bucket/cg-manuals` -> 404
"Bucket not found"; the bucket list visible to that key is empty.
