# Devpost submission: Physical Memory (Next Gen Award)

Copy each section into the matching Devpost field.

---

## Project name
Physical Memory

## Tagline
Point your camera at where you put something. Ask for it later. It tells you where it was last seen, how sure it is, and shows you the photo.

## Built with
react-native, expo, typescript, supabase, postgresql, pgvector, claude, revenuecat, sqlite, deno

## Try it out
- Source code (MIT): https://github.com/ParishruthiGanesh/RevenueCat-Shipaton
- Demo video: <YOUTUBE LINK>
- Download for Android (APK): https://expo.dev/artifacts/eas/M3kvxTo_vq1vSsS29JA3vIw7qbPD5n6HXK49urjQhxc.apk

---

## Inspiration

My phone remembers every photo I have ever taken, and it still can't tell me where I put my passport.

The tools that try have the same flaw. AirTags need a tag on every object. Inventory apps need you to type everything in, so after a week nobody keeps them up to date. Both treat "where is it" as a field you fill in once.

But that isn't how you remember things. You remember *seeing* them: "it was in the blue pouch, in the top drawer, on Sunday." That memory has a time, a place inside a place, and a level of confidence. It fades, and it can be wrong.

So I built an app that remembers things the way you do, and is honest about it.

## What it does

**You show it. You ask. It answers with evidence.**

> "Remember where I'm putting my passport." *(one photo)*
>
> Three days later: **"Where's my passport?"**
>
> **"Last seen in the blue document pouch, in the top drawer of the black dresser, in the bedroom. Sunday, 8:14 PM. High confidence."** *Here is the photo.*

Note the wording. It never says where your passport **is**. It says where it was **last seen**, because that is all it actually knows. That is the whole difference.

Then things change, and the answer changes honestly with them:
- **You rescan the drawer and the pouch isn't there.** Confidence drops, and the app tells you why. Not seeing something is not the same as proof it's gone.
- **You move a storage box.** Everything inside it moves too. Every box gets a printable QR label, and scanning the label shows what's inside.
- **You have two black chargers.** When it isn't sure which one it's looking at, it asks *"Is this the same Anker charger?"* It never silently merges them.
- **You lent your camera to Sarah.** "Where's my camera?" answers *"with Sarah"*, not with an old shelf.

**Hold to scan.** Hold the shutter and sweep across a shelf. It captures up to 16 frames and reports what's new, what's still there, what moved, and what wasn't seen.

**Family.** One Pro member creates a family. Everyone else joins free with a 6-letter code. Share a space like "Home", and family members can ask *"Where did Dad put the drill?"* Answers say who added each item. Sensitive items (passports, IDs, medication) and private zones never leave your account, and the database enforces that, not just the app.

**Built for everyone.** Simple Mode shows one big sentence and the photo. Large text, high contrast and voice input are built in. It helps older adults, caregivers and busy families.

## How I built it

**Location is never stored as a field.** This is the one decision everything else follows from.

Every photo adds an **observation** to an append-only log: *seen here*, *not seen here*, or *removed*. Each one carries a time, a source, a confidence and its photo. Where something is right now is **calculated** from that history every time you ask:

- **Strength:** how good was the evidence (strength × source × whether you confirmed it).
- **Decay:** how fast it goes stale depends on how often that kind of thing moves. For keys that's about 18 hours. For a passport it's about 60 days.
- **Contradiction:** a blurry new sighting can't override a clear old one.
- **Containers:** if the box is missing, everything inside it becomes less certain.

**The AI sees but never speaks.** Claude vision, running in a Supabase Edge Function, returns strict structured JSON: objects, containers, how they're nested, and bounding boxes. The answer sentence is built by code from the evidence, so every word can be traced back to a photo. The AI can't invent a location.

**Stack:**
- **Expo / React Native + TypeScript.** Local-first SQLite, so it works offline.
- **Supabase Postgres + pgvector.** Row-level security on every table. A trigger stops anyone editing history. Family policies hide sensitive items server-side.
- **RevenueCat.** The `physical_memory_pro` entitlement unlocks unlimited items and AI scans, full history, travel mode, cloud backup and **creating a family**. The paywall reads the live RevenueCat offering, so no prices are hardcoded. There's a free trial, restore, and a webhook that mirrors entitlements on the server.
- **Quality.** 73 automated tests for the hard cases (two identical chargers, a mislabelled passport, an object that disappears, a lent item, a box that moves), plus migration and RLS checks against real Postgres.

## Challenges I ran into

**Honesty is harder than accuracy.** Early versions said "other possible places" for locations that newer photos had already ruled out. They also flagged a box as "moved" when the app had simply learned more about it. Each of these became a test.

**Family sync.** My first share uploaded 1 record out of 17, because the app sent items before the rooms they sat in, and the database rejected the orphans. The fix was to upload every item together with its whole chain of places (item → shelf → room → home) and the photos that prove it.

**Privacy you can verify.** "We don't share your passport" had to be a database rule, not a promise in the UI. I wrote tests that try to read another member's sensitive items and check that they fail.

## Accomplishments I'm proud of

- Every answer can show its proof: *where, when, how sure, and the photo.*
- Privacy controls are real features: private zones, automatic blurring of sensitive items, cloud AI you can turn off, and delete-everything.
- I built it solo, as a student, end to end: mobile app, database, AI pipeline and payments.

## What I learned

- **Uncertainty is a feature.** *"I found two possible matches"* earns more trust than a confident wrong answer.
- **Let AI perceive, not decide.** The model is great at seeing. Code should own the claims.
- **Store what you saw, not what you concluded.** Conclusions go stale. Observations don't.

## What's next

- Recognising rooms from visual landmarks, so you don't have to pick the room.
- Optional passive memory from smart glasses, with private zones respected by default.
- A Play Store and App Store launch.

---

## Testing instructions for judges

1. Open the app and tap **Sign in** (email code, or Google on Android). You can also skip it and look around first.
2. **Pro:** tap **Upgrade to Pro → Start free trial** (or **Continue**). This is RevenueCat's Test Store, so choose *successful purchase*. No real payment is taken.
3. **Family:** go to **You → Family → Create family** (needs Pro), then share the invite code with a second account.
4. **Try asking:** "Where's my passport?", "What's in Box 17?", "Where did <family member> put the charger?"
