# Verify & lock, admin delete (v1.8)

* New machines are **Drafts**: admins can edit and test them.
* **Verify & lock** (admin, machine page or editor) shows a confirm with the constants, formulas, inputs and trains,
  then stores `{"locked": true, "lockedAt": "<ISO time>", "lockedBy": "<QC username>"}` at the top level of
  `cg_machines.formulas` (next to `app`, `schema`, `def`).
* Locked: the definition (inputs, constants, formulas, outputs, trains) is read-only for everyone, admins included.
  The editor shows a Locked badge with who/when. Locked machines can be calculated and **Copied to a new draft**.
  Their index/differential gear lists and index presets stay admin-editable (clear / delete too); a deleted list makes
  the train fall back to the built-in 20-88 list. Trains of a locked machine cannot be removed.
* **Delete machine** only when `cg_can_delete()` is true, with a confirm, for drafts and locked machines. Built-ins: never.
  (Soft delete: `deleted_at` set, name freed.)
* **Gear train sets**: admins can remove the index or differential train of a draft, and clear or delete any gear list
  (incl. a machine's own lists). Every delete confirms. Viewers see none of these buttons.

## The lock is NOT enforced by the database
RLS only checks `cg_can_edit()`. Any admin session could still PATCH `formulas` of a locked row through the API.
The app refuses it (store.js keeps the locked definition and only lets train gear-list links change), but that is
client-side only. Proposed trigger for the QC backend owner (NOT applied):

```sql
-- Proposed migration 005 (not applied): freeze locked Change Gear machine definitions.
create or replace function public.cg_machines_lock_guard()
returns trigger language plpgsql as $$
declare
  old_def jsonb := old.formulas -> 'def';
  new_def jsonb := new.formulas -> 'def';
begin
  if coalesce((old.formulas ->> 'locked')::boolean, false) then
    -- lock fields themselves cannot be removed or changed
    if coalesce((new.formulas ->> 'locked')::boolean, false) is not true
       or new.formulas -> 'lockedAt' is distinct from old.formulas -> 'lockedAt'
       or new.formulas -> 'lockedBy' is distinct from old.formulas -> 'lockedBy' then
      raise exception 'Machine "%" is locked: the lock cannot be removed', old.name using errcode = '42501';
    end if;
    -- name and definition frozen, except each train's "inventory" link (gear lists stay editable)
    if new.name is distinct from old.name and new.deleted_at is null then
      raise exception 'Machine "%" is locked: it cannot be renamed', old.name using errcode = '42501';
    end if;
    if (old_def #- '{trains}') is distinct from (new_def #- '{trains}')
       or jsonb_array_length(coalesce(old_def -> 'trains', '[]')) <> jsonb_array_length(coalesce(new_def -> 'trains', '[]'))
       or exists (
         select 1 from jsonb_array_elements(coalesce(old_def -> 'trains', '[]')) with ordinality o(t, i)
         join jsonb_array_elements(coalesce(new_def -> 'trains', '[]')) with ordinality n(t, i) using (i)
         where (o.t - 'inventory') is distinct from (n.t - 'inventory')) then
      raise exception 'Machine "%" is locked: its formulas cannot be changed', old.name using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists cg_machines_lock_guard on public.cg_machines;
create trigger cg_machines_lock_guard before update on public.cg_machines
  for each row execute function public.cg_machines_lock_guard();
```

Soft delete (setting `deleted_at` and renaming to `"<name> [deleted <time>]"`) is still allowed by the trigger;
hard delete is governed by RLS (`cg_can_delete()`).
