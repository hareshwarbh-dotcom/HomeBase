# HomeBase

**One calm place for your home**: chores, bills, reminders and groceries, for one person or shared with a partner.

Live app: **https://aahahome.pages.dev** (installs on the phone as *AaHaHome*)

---

## What it does

| Tab | What's in it |
|---|---|
| 🏠 **Home** | What needs attention now: overdue and upcoming items, plus a quick summary |
| ✅ **Tasks** | Snap a photo, set a due date and priority. Assign it to yourself, your partner, or both. Undo if you tick by mistake |
| 💰 **Money** | **Obligations**: EMIs, rent, insurance, subscriptions (monthly / quarterly / half-yearly / yearly / one-time), with month-by-month paid tracking. **Expenses**: day-to-day spending by category |
| 🗓️ **Upcoming** | One timeline of payments and to-do reminders (car service, PUC, documents), each with its own "remind me" lead time |
| 🧺 **Household** | Grocery list, house help (leaves and salary), important dates |

Also included:
- **Optional partner.** Works fine solo; add a partner anytime in Settings → People.
- **Free account + cloud sync** between phones and laptop (Supabase), live and offline-friendly.
- **Explore first** with sample data, no sign-up needed.
- **Phone calendar alerts.** Settings → *Add all to phone calendar* exports repeating events with reminders.
- **Display & theme.** Text size, density, dark mode, accent colour.
- **Backups.** Export or import a JSON file.

---

## Install on a phone

- **iPhone:** open the link in **Safari**, then Share → **Add to Home Screen**
- **Android:** open in **Chrome**, then ⋮ → **Install app**

---

## How it's built

- A single `index.html` file (plain HTML, CSS and JavaScript). No build step.
- Hosted on **Cloudflare Pages**, auto-deployed from this GitHub repo (free: ~500 updates/month, unlimited visitors).
- Data is stored on the device (`localStorage`), and optionally synced through **Supabase**.

### Files in this repo

| File | Purpose |
|---|---|
| `index.html` | The whole app |
| `manifest.webmanifest` | App name, icon and full-screen settings for "install as app" |
| `icon-192.png`, `icon-512.png` | App icons |
| `sw.js` | Service worker: instant, offline-capable launch |
| `README.md` | This file |

---

## Updating the app

1. Get the new `index.html` (or edit it).
2. GitHub → **Add file → Upload files**, drop it in, then **Commit changes**.
3. Cloudflare Pages publishes it automatically in about a minute. Reopen the app to see it.

Your data is not touched by updates: it lives on each device and in Supabase, not in this repo.

---

## Cloud sync setup (one time)

1. Create a project at **supabase.com** (region: Mumbai).
2. **SQL Editor → New query**, paste the SQL below, then **Run**.
3. **Authentication → Sign In / Providers → Email**: turn **off** "Confirm email".
4. Copy the **Project URL** and the **publishable key** (never the secret / service_role key).
5. Put both values in `index.html` (constants `SB_URL` and `SB_KEY` near the top of the sync code). They're already set for this project.
6. Users then just tap **Create free account** (email + password); a household is created automatically. Partners tap **Join with code** and enter the 6-letter invite code.

<details>
<summary>SQL to run in Supabase</summary>

```sql
create table households (
  id uuid primary key default gen_random_uuid(),
  name text,
  invite_code text unique default upper(substr(md5(random()::text),1,6)),
  created_at timestamptz default now()
);
create table members (
  household_id uuid references households on delete cascade,
  user_id uuid references auth.users on delete cascade default auth.uid(),
  primary key (household_id, user_id)
);
create table items (
  household_id uuid references households on delete cascade,
  col text, id text, data jsonb,
  deleted boolean default false,
  updated_at timestamptz default now(),
  updated_by uuid default auth.uid(),
  primary key (household_id, col, id)
);

create function is_member(h uuid) returns boolean
language sql security definer set search_path = public as $$
  select exists(select 1 from members where household_id = h and user_id = auth.uid())
$$;

alter table households enable row level security;
alter table members enable row level security;
alter table items enable row level security;
create policy "see own household" on households for select using (is_member(id));
create policy "see members" on members for select using (is_member(household_id));
create policy "read write items" on items for all
  using (is_member(household_id)) with check (is_member(household_id));

create function create_household(p_name text) returns households
language plpgsql security definer set search_path = public as $$
declare h households;
begin
  insert into households(name) values (p_name) returning * into h;
  insert into members(household_id, user_id) values (h.id, auth.uid());
  return h;
end $$;

create function join_household(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare hid uuid;
begin
  select id into hid from households where invite_code = upper(trim(p_code));
  if hid is null then raise exception 'Invalid invite code'; end if;
  insert into members(household_id, user_id) values (hid, auth.uid()) on conflict do nothing;
  return hid;
end $$;

create function touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger items_touch before update on items for each row execute function touch();

alter publication supabase_realtime add table items;
```

Photos (Supabase Storage, private, per household):

```sql
insert into storage.buckets (id, name, public) values ('photos', 'photos', false)
on conflict (id) do nothing;

create policy "household can view photos" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy "household can add photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy "household can update photos" on storage.objects for update to authenticated
  using (bucket_id = 'photos' and public.is_member(((storage.foldername(name))[1])::uuid));
create policy "household can delete photos" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and public.is_member(((storage.foldername(name))[1])::uuid));
```
</details>

## Notifications

Morning summaries and "partner assigned you a task" alerts are sent by the Supabase Edge Function `notify` (source kept outside this repo), triggered hourly by `pg_cron`. Notifications contain item names only, never amounts. Users opt in under Settings → Preferences. On iPhone they work only in the installed (home-screen) app.

**Security note:** the publishable key is meant to be public. Each household's data is protected by row-level security, so only its members can read or write it.
