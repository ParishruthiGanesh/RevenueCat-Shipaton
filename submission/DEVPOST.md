# Devpost submission — Physical Memory (Next Gen Award)

Copy each section into the matching Devpost field.

---

## Project name
Physical Memory

## Elevator pitch (one line)
Google Search for the physical things in your life: show the camera where you put something, then just ask, and it tells you where it was last seen, how sure it is, and shows you the photo.

## Built with
react-native, expo, typescript, supabase, postgresql, pgvector, claude, anthropic, revenuecat, sqlite, deno

## Links
- Source code (open source, MIT): https://github.com/ParishruthiGanesh/RevenueCat-Shipaton
- Demo video: <YOUTUBE LINK>

---

## About the project

### Inspiration
Everyone loses things they own: a passport before a trip, the charger that goes with the laptop, which box holds the winter clothes. AirTags need hardware on every object. Inventory apps make you type everything in, so nobody keeps them up to date. We wanted the opposite: **show it to the camera, say "remember this," and ask for it later in plain words.**

### What it does
- **Remember this.** Point the camera and say *"Remember where I'm putting my passport."* Vision AI works out the object and where it's going (**Passport → blue pouch → top drawer → black dresser → bedroom**). You confirm or correct it in seconds.
- **Ask.** *"Where's my passport?"* → **"Last seen in the blue document pouch, in the top drawer of the black dresser, in the bedroom — today at 8:14 PM."** It shows a confidence level, the photo that proves it, and the full place hierarchy.
- **Honest, not magical.** It never claims where something *is*, only where it was *last seen*. Rescan a drawer and the passport's pouch isn't there? Confidence drops, and the app says exactly why. Not being detected isn't treated as proof something is gone.
- **Scan a drawer, shelf or bag** to see *what changed*: added, still here, moved, not detected.
- **Storage boxes** with printable QR labels. Scan a label to see what's inside. Contents follow the box when it moves.
- **Object history:** every place something has been, and where you *usually* keep it.
- **Tells similar objects apart:** *my black Anker charger* vs *my white Apple charger*. When it's unsure, it asks "Is this the same…?" instead of silently merging.
- **Loans:** *"I lent my camera to Sarah"*. Asking where the camera is reports the loan, not a stale location.
- **Travel mode:** items count as packed when the camera sees them in the bag, not when you tick a box.
- **Accessibility:** Simple Mode (one big sentence and the photo), large text, high contrast, voice first. It's an organisational aid for older adults, caregivers and busy families, not a medical device.
- **Privacy by design:** local-first storage, cloud AI can be turned off, people automatically cropped out of photos, sensitive items (passports, IDs, medication) blurred and never read, private zones, and delete anything including your whole account.

### How we built it
- **Expo / React Native + TypeScript**, local-first **SQLite** with an in-memory graph index and a sync outbox, so capture works offline.
- **A temporal physical knowledge graph.** Location is never stored as a field. It's derived from an **append-only log of observations** (sighting / absence / removal), each with time, source, confidence, verification and photo evidence.
- **An uncertainty engine:** evidence strength × source × verification, with time decay tuned to how often each kind of object moves (keys ~18h, passports ~60 days). A weak newer sighting can't erase a strong older one, and a missing container lowers confidence for everything inside it.
- **Perception:** a **Claude** vision model returns strict structured JSON (objects, containers, relations, boxes) through a Supabase Edge Function. The app re-identifies each detection against your existing objects. **The AI never writes the answer:** answers are composed deterministically from evidence, so every sentence is traceable.
- **Supabase** Postgres with **pgvector**, row-level security on every table, an append-only trigger on observations, family-sharing policies that hide sensitive items, and sign-in with Google or an email code.
- **RevenueCat:** the `physical_memory_pro` entitlement unlocks unlimited items, boxes and AI scans, full history, travel mode, smart questions and backup. The paywall renders whatever the current RevenueCat offering contains (no hardcoded prices), with purchase, restore, entitlement checks and a server-side webhook mirror.
- **Quality:** 71 tests covering the hard cases (identical chargers, a mislabelled passport, a disappearing object, lending, a box that moves, a container going missing), plus migration and RLS validation on real Postgres.

### Challenges we ran into
Keeping the app honest. Early versions showed old superseded places as "other possible places" and flagged a box as "moved" when we had only learned where it lived later. Each bug became a test. Telling identical objects apart without silent merges also took several iterations of the matching score.

### Accomplishments we're proud of
Answers that are trustworthy by construction ("last seen… with this confidence… here's the photo"), a design that feels calm rather than technical, and privacy controls that are real features.

### What we learned
Uncertainty is a product feature. Saying *"I found two possible matches"* earns more trust than a confident guess.

### What's next
Room recognition from visual landmarks, opt-in passive memory from wearables and smart glasses (with private zones), family spaces, and a Play Store launch.

---

## Testing instructions for judges
- The demo uses RevenueCat's Test Store: tapping **Upgrade to Pro → Continue** shows RevenueCat's test purchase sheet. Choose "successful purchase" to unlock all Pro features, with no payment.
- Sign in with an email code, or Google on Android.
