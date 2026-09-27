# Setup

The app works locally with no configuration. This guide turns on the cloud pieces.

## 1. Supabase (auth, database, storage, AI functions)

```bash
npm i -g supabase          # or use npx supabase
supabase login
supabase link --project-ref <your-ref>
supabase db push           # applies supabase/migrations
supabase functions deploy analyze-scene interpret-query embed delete-account revenuecat-webhook
```

In the dashboard:

- **Auth → Providers → Anonymous sign-ins: enable.** Users start anonymous, with no sign-up wall. Every Edge Function still requires a valid user JWT, so none of them is an open AI proxy.
- Copy **Project URL** and **anon key** into `.env` as `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY`.

Secrets (server only, never in the app):

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase secrets set REVENUECAT_WEBHOOK_SECRET=$(openssl rand -hex 24)
# optional
supabase secrets set VOYAGE_API_KEY=...            # multimodal embeddings
supabase secrets set PM_VISION_MODEL=claude-opus-5  # override model
```

Before deploying, verify locally:

```bash
npm run db:validate       # migration + RLS checks on real Postgres (PGlite)
npm run functions:check   # Deno type-checks all functions
```

## 2. RevenueCat (required for purchases)

1. Create a project. Add the iOS app (bundle id `app.physicalmemory`) and the Android app (package `app.physicalmemory`).
2. Create products in App Store Connect / Play Console, e.g. `pm_pro_monthly` and `pm_pro_annual` (with an optional free trial).
3. RevenueCat → **Entitlements**: create `physical_memory_pro` and attach both products.
4. **Offerings**: create a `default` offering with `$rc_monthly` and `$rc_annual` packages and make it current. The paywall renders whatever this offering contains, so no prices live in code.
5. Copy the public SDK keys into `.env`: `EXPO_PUBLIC_REVENUECAT_IOS_KEY`, `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY`.
6. **Integrations → Webhooks**: URL `https://<ref>.supabase.co/functions/v1/revenuecat-webhook`, Authorization header `Bearer <REVENUECAT_WEBHOOK_SECRET>`.

The app calls `Purchases.logIn(<supabase user id>)`, so webhook events map to the right user and server-side AI quotas follow the entitlement.

Test with sandbox accounts (iOS) or license testers (Android). Restore purchases is on the paywall and in **You**.

## 3. OneSignal (optional)

Set `EXPO_PUBLIC_ONESIGNAL_APP_ID`. Local notifications (loans, trips) work without it. OneSignal adds identity (`login(userId)`) and coarse, non-sensitive segment tags.

## 4. Build

```bash
npx expo run:ios                        # local dev build
npx eas-cli@latest build --profile development --platform ios
npx eas-cli@latest build --profile production  --platform all
```

Camera, speech recognition, RevenueCat and OneSignal are native modules, so use a development build rather than Expo Go.

## 5. Environment variables

| Variable | Where | Required |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` | app | for cloud AI and sync |
| `EXPO_PUBLIC_REVENUECAT_IOS_KEY`, `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` | app | for purchases |
| `EXPO_PUBLIC_ONESIGNAL_APP_ID` | app | optional |
| `ANTHROPIC_API_KEY` | Supabase secret | for AI scene analysis |
| `REVENUECAT_WEBHOOK_SECRET` | Supabase secret | for the entitlement mirror |
| `VOYAGE_API_KEY` | Supabase secret | optional |
| `PM_VISION_MODEL`, `PM_QUERY_MODEL`, `PM_EMBED_MODEL` | Supabase secret | optional overrides |
