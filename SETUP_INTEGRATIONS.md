# Setup: Strava sync + daily push reminders

The code for both is deployed with the app, but each needs one-time setup you have
to do yourself (accounts, secrets, database tables). Work through this top to bottom.

## 1. Database tables (Supabase)

Supabase dashboard → SQL Editor → paste and run:

```sql
-- Strava OAuth tokens, one row per connected user
create table if not exists strava_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  athlete_id bigint,
  athlete_name text,
  access_token text not null,
  refresh_token text not null,
  expires_at bigint not null,
  created_at timestamptz default now()
);
alter table strava_connections enable row level security;
create policy "own strava row" on strava_connections
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Web-push subscriptions (one row per browser/device that enabled reminders)
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text unique not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz default now()
);
alter table push_subscriptions enable row level security;
create policy "own push rows" on push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

## 2. Strava API app

1. Go to https://www.strava.com/settings/api and create an application.
2. **Authorization Callback Domain**: your production domain (e.g. `milkbag.vercel.app`) — no `https://`, no path.
3. Note the **Client ID** and **Client Secret**.

Add to Vercel (Project → Settings → Environment Variables) and to `.env.local` for dev:

```
NEXT_PUBLIC_STRAVA_CLIENT_ID=<your client id>
STRAVA_CLIENT_SECRET=<your client secret>
```

For local dev, also add `localhost` to the callback domain field (Strava allows it alongside your domain).

## 3. Install the new dependency

On your Mac, in the repo:

```
npm install
```

(This pulls in `web-push`, used by the reminder cron.)

## 4. VAPID keys (push identity)

Generate once, anywhere:

```
npx web-push generate-vapid-keys
```

Add to Vercel env (and `.env.local`):

```
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<public key>
VAPID_PRIVATE_KEY=<private key>
```

## 5. Cron + service key (daily reminder sender)

```
CRON_SECRET=<any long random string>
SUPABASE_SERVICE_ROLE_KEY=<Supabase dashboard → Settings → API → service_role>
```

- `vercel.json` already schedules `/api/push/daily` at **06:00 UTC** (~08:00 in Sweden). Change the cron expression there if you want a different time.
- Vercel automatically sends `Authorization: Bearer <CRON_SECRET>` to cron routes once the env var exists.
- ⚠️ The service-role key bypasses RLS — it must only ever live in server env vars, never in client code or `NEXT_PUBLIC_*`.

## 6. Try it

- **Strava**: Settings → Connections → Connect → approve on Strava → log any workout → it appears on your Strava feed with "Logged with Milkbag 🥛".
- **Reminders**: Settings → Daily reminder → On (on iPhone this only works after adding the app to the Home Screen, iOS 16.4+). Test the sender manually:
  `curl -H "Authorization: Bearer <CRON_SECRET>" https://<your-domain>/api/push/daily`

## Notes

- Strava sync is a *manual activity* (title, type, duration, distance) — GPS traces from the in-app run tracker aren't uploaded as routes yet; that's a possible v2 (GPX upload API).
- Editing and re-saving a workout will NOT duplicate the Strava activity (the log remembers its activity id).
- Badges and the weekly recap need no setup — they're computed from existing logs.
