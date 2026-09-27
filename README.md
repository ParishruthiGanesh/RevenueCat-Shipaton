# Physical Memory

**Google Search for the physical things in your life.**

Point your phone at something, say *"Remember where I'm putting my passport"*, and later just ask *"Where's my passport?"*:

> **Last seen in the blue document pouch, in the top drawer of the black dresser, in the bedroom — today at 8:14 PM.**
> High confidence · You photographed it · [photo]

Physical Memory is a perception-first memory system for your belongings, not an inventory app. It keeps a **temporal knowledge graph** of objects, containers, furniture, rooms and spaces. It builds that graph from camera observations and your voice, and answers natural-language questions with **evidence, timestamps and honest confidence**. It never claims to know where something *is*. It tells you where it was *last seen*, and how sure it is.

Built for the RevenueCat Shipaton.

---

## What works today

| | |
|---|---|
| **Remember this** | Camera + voice capture. Vision AI proposes `Passport → Blue pouch → Top drawer → Black dresser → Bedroom`, and you confirm or correct it in seconds. |
| **Ask** | Voice or text: *where is*, *which box has*, *what's inside*, *where do I usually keep*, *when did I last see*, *was it ever in*, *what's lent out*, *how many chargers do I have*, *what changed in my bedroom this week*… Answers are composed deterministically from the graph, never free-written by an LLM. |
| **Scan an area** | Drawer / shelf / cabinet / desk / room / backpack / suitcase. Produces a diff: **added · still here · moved in · not detected**. "Not detected" lowers confidence; it never says something is gone. |
| **Storage boxes** | Photograph contents → numbered box → printable **QR label** (offline-generated, encodes only an opaque code). Scan the label later to see contents or record where the box is now. Contents follow the box when it moves. |
| **Object history** | Full journey per object, usual location (weighted by dwell time), previous location, per-observation delete / "this sighting was wrong". |
| **Instance identity** | Tells *my black Anker charger* from *my white Apple charger*. Ambiguous matches ask *"Is this the same…?"* and are never merged silently. |
| **Uncertainty engine** | Evidence strength × source × verification × mobility-aware time decay. A weak newer sighting can't erase a strong older one. Container absence propagates to the objects inside it. |
| **Loans, ownership, travel** | *"I lent this camera to Sarah"* → answers report the loan, not a stale location. Owner filters (*"Revanth's charger"*). Travel checklists confirmed by what the camera saw in the bag. |
| **Privacy** | Local-first. Cloud AI is optional. People-minimising crops, never-read-text mode, sensitive objects (blurred, excluded from sharing), private zones, per-item / per-sighting / erase-everything deletion. |
| **Offline** | Everything except cloud vision works offline. Captures taken offline are kept and queued. |
| **Pro (RevenueCat)** | Real offerings, purchase, restore and entitlement (`physical_memory_pro`), mirrored server-side by webhook for quota enforcement. |
| **Accessibility** | Simple mode (big buttons, one-sentence answers), large text, high contrast, voice first, full screen-reader labels. Confidence is never shown by colour alone. |

## Architecture in one picture

```
 Camera / voice ─► frame selection ─► analyze-scene (Claude vision, structured output)
                                            │  objects, containers, relations, bboxes
                                            ▼
                         draft builder: user's words > known places > what the model saw
                         + instance re-identification against the memory graph
                                            │   (user confirms / corrects)
                                            ▼
        append-only OBSERVATIONS ──► temporal knowledge graph (entities, relations)
                                            │
     uncertainty engine ◄───────────────────┤──────────► hybrid retrieval
     (belief + confidence + caveats)        │            (lexical + semantic + attributes + graph)
                                            ▼
                     deterministic, evidence-grounded answers ("Last seen …")
```

Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Repository layout

```
src/core/        Pure TypeScript domain: graph, observations, beliefs (uncertainty engine),
                 matching (re-identification), search, query parser, answers, operations
src/ai/          Capture pipeline client + draft builder (vision output → reviewable draft)
src/data/        SQLite persistence, media files, sync engine, Postgres mapping
src/services/    Supabase, RevenueCat, notifications (local + OneSignal), analytics, voice
src/state/       React providers: memory graph, settings, session, entitlements, background tasks
src/ui/          Design tokens, theme, components (AnswerCard, Timeline, Breadcrumb, …)
src/app/         Expo Router screens
supabase/        Postgres migration (pgvector, RLS) + Edge Functions (Deno)
scripts/         validate-db.mjs — runs the migration on real Postgres (PGlite) and tests RLS
docs/            Architecture, privacy policy, terms, demo script, setup
```

## Quick start

Requirements: Node 20+, a device or simulator. Camera, voice and purchases need a **development build**; Expo Go doesn't include those native modules.

```bash
npm install
cp .env.example .env         # fill in public keys (see docs/SETUP.md)
npx expo run:ios             # or: npx expo run:android  /  eas build --profile development
```

The app runs **without any keys**. You get local memory, manual/voice labelling, search, boxes and history. Cloud vision needs Supabase plus an Anthropic API key, and purchases need RevenueCat keys. Full backend setup: [docs/SETUP.md](docs/SETUP.md).

## Quality gates

```bash
npm run typecheck        # TypeScript strict
npm run lint             # ESLint + React Compiler rules
npm test                 # 71 unit + integration tests (core, AI draft, sync mapping, demo script)
npm run db:validate      # applies migrations to real Postgres (PGlite + pgvector) and tests RLS
npm run functions:check  # Deno type-checks every Edge Function against the real SDKs
npm run check            # all of the above
```

The test suite covers the hard cases: two identical chargers, an object disappearing from a drawer, the AI mislabelling a passport, the same object in two observations, a newer low-confidence vs an older high-confidence sighting, manual override, lending, container absence propagating to contents, boxes that move, free-tier gating, and the full demo script run through the real draft → commit → ask path.

## Demo

See [docs/DEMO.md](docs/DEMO.md) for the 14-step Shipaton demo. In development builds, **You → Developer → Load demo scenario** seeds a sample home (clearly labelled, no photos) for reviewing UI states without a camera.

## Status and honesty notes

- Room recognition, passive capture, smart-glasses/tracker integrations and family invites are **designed for** (schema, RLS, privacy controls and interfaces exist) but not shipped as user features. The app says so rather than pretending.
- Web runs for UI review only (`npm run web`). The product targets iOS and Android.
