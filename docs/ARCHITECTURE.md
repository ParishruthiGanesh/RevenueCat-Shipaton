# Architecture

Physical Memory is built so V1 (intentional memory) grows into V2 (the app understands the environment) and V3 (passive, multi-device physical memory) without a rewrite. The key decision is that **location is never stored. It is derived from evidence.**

## 1. The temporal physical knowledge graph (`src/core`)

| Concept | What it is |
|---|---|
| **Entity** | A node: `space` (Home, Storage unit), `room`, `fixture` (dresser, desk, shelf unit), `container` (drawer, box, shelf level) or `item`. Items can be containers too (pouch, backpack, suitcase). Carries visual attributes (colours, brand, model, size, distinguishing marks), aliases, owner, `sensitive`, `privateZone`, and optional box metadata. |
| **Observation** | Append-only evidence: `sighting` (seen/stated at a placement), `absence` (a scan of X did **not** detect it) or `removal` ("that's no longer there"). Each one records time, source (camera, area scan, box scan, QR, voice, manual, setup, passive, tracker), evidence kind (observed / user-stated / inferred), detector confidence, instance-match confidence, verification (unverified / confirmed / corrected / rejected), media + bbox, and the **ancestor chain as it was at that moment**. |
| **Relation** | Non-spatial facts with validity intervals: `BELONGS_TO`, `LENT_TO`, `PART_OF`, `NOT_SAME_AS`, … |
| **Correction** | AI prediction vs user truth, kept as learning signal. |

Placement is hierarchical (`Passport INSIDE Pouch INSIDE Top drawer LOCATED_IN Dresser LOCATED_IN Bedroom LOCATED_IN Home`). Chains are resolved **as of a time**, which is how boxes carry their contents when they move, and how history stays truthful after furniture is rearranged.

Everything in `src/core` is dependency-free TypeScript, so it's fully unit-tested and portable to a server or another client.

## 2. The uncertainty engine (`beliefs.ts`)

For each object, the engine computes a `LocationBelief`:

1. **Strength** = source base × evidence factor × detection confidence × match confidence, boosted when the user confirmed or corrected it.
2. **Time decay** with a half-life set by **mobility**: keys ~18h, chargers ~7d, passports ~60d, boxes ~1y. Mobility is learned: objects that moved often decay faster.
3. **Support**: repeated sightings in the same place reinforce each other.
4. **Contradiction**: a newer sighting elsewhere discounts older ones *in proportion to its own strength*. So a strong newer sighting supersedes, and a weak ambiguous one only adds an "uncertain newer sighting" caveat.
5. **Absence**: not being detected in a scan of the believed container multiplies confidence by 0.3 and adds a caveat. It never removes the object.
6. **Container absence propagation**: if the pouch the passport was in wasn't detected in a later scan, the passport's belief drops too, and the answer says why.
7. **Overrides**: an active loan reports the loan (plus the last sighting before it). An explicit removal reports "unknown since".

The output is `HIGH / MEDIUM / LOW / UNKNOWN`, flags, alternatives and caveats. `phrasing.ts` turns these into sentences **deterministically**, always in "last seen" language.

## 3. Perception pipeline

```
capture (1–8 frames) ─► select ≤6 evenly spaced ─► downscale to 1568px JPEG
   ─► Edge Function analyze-scene (auth + quota) ─► Claude vision
         structured output (zod schema shared by server & app), refusal fallbacks
   ─► client re-validates + clamps ─► evidence crops per object (people-minimising)
   ─► draft builder:
        • user's words win (voice "remember I'm putting my charger in the left drawer")
        • scene places reconciled with existing structure (no duplicate "Top drawer")
        • every object re-identified against the graph: same / ask / new
   ─► review screen (edit names, "Actually…", identity prompts, hierarchy editor)
   ─► commitCapture: places → items → sightings → corrections → absences → diff
```

Model choices:

- **Scene understanding:** `claude-opus-5` with adaptive thinking at medium effort, strict JSON-schema output, and server-side refusal fallbacks. The model never writes answers to questions.
- **Query interpretation:** used only when the on-device parser is unsure (confidence < 0.5). It maps the question to the same structured intent the local parser produces, and never sees the inventory.
- **Embeddings:** an on-device feature-hashed embedding (words + synonyms + character trigrams) gives offline semantic matching. `embed` (Voyage multimodal, 1024-d) adds image↔text vectors in pgvector when configured. Deterministic tasks (dates, hierarchy, diffing, confidence) never use an LLM.

## 4. Instance re-identification (`matching.ts`)

Score = name/alias similarity (synonym-aware) + description similarity + image-embedding similarity (when present) + attribute evidence (a brand or colour conflict is a strong negative) + distinguishing marks + category agreement + spatial prior (last seen in this same spot). Decisions:

- `same`: ≥ 0.80 **and** clearly ahead of the runner-up.
- `ask`: ambiguous. The UI asks *"Is this the same…?"* with Yes / No / Not sure.
- `new`: otherwise. "No" writes a `NOT_SAME_AS` relation, so the app never asks about that pair again.

## 5. Retrieval (`search.ts`, `query.ts`, `ask.ts`)

A deterministic parser covers ~17 intents offline. Hybrid ranking combines structured filters (owner, place subtree), lexical coverage over names, aliases, descriptions and past labels, semantic similarity, and colour agreement. Low or tied scores return **several candidates** instead of a guess. Results are typed (`item`, `candidates`, `contents`, `history`, `usual`, `list`, `changes`, `none`) and rendered as cards.

## 6. Storage and sync

- **Device:** SQLite (JSON rows per table) is the UI's source of truth, loaded into an in-memory graph index. Every commit is written through in a transaction and appended to an **outbox**.
- **Cloud (Pro):** the outbox drains in dependency order into Postgres. Media uploads to the private `media/<uid>/` bucket first. Upserts are idempotent. Restore pulls everything down.
- **Postgres:** a normalised schema (`supabase/migrations`) with enums, check constraints, an **append-only trigger on observations**, pgvector HNSW indexes, a hybrid `search_entities` RPC, security-invoker views (`spaces`, `rooms`, `containers`, `objects`, `storage_boxes`, `object_aliases`, `latest_sightings`) and **RLS on every table**.
- **Family mode:** `households` + `household_members` (owner/member/viewer). Members can read shared entities, **except sensitive objects and private zones**, enforced in RLS (`npm run db:validate` tests this). Known limitation, to fix before family invites ship: an item *inside* a private-zone container is currently hidden only if its own row is marked private or sensitive. Items in the zone aren't yet un-shared automatically.

## 7. Monetization (RevenueCat)

The `physical_memory_pro` entitlement gates unlimited items, boxes, AI scans, full history, travel mode, smart questions, cloud sync and family features. Offerings, packages, prices and trials all come from the dashboard. The paywall renders whatever the current offering contains. The `revenuecat-webhook` Edge Function mirrors entitlement state to `subscriptions`, so AI quotas are enforced server-side.

## 8. Notifications

`insights.ts` decides what's worth saying: overdue loans, trip items ticked but not seen in the bag, boxes without a room, recent scans that missed things. Local notifications deliver them, and OneSignal adds orchestration and coarse segments (never object names). Each insight is sent at most once, only if the user enabled reminders, and permission is requested only when they turn the feature on.

## 9. V2 and V3 readiness

| Capability | What already exists |
|---|---|
| Room recognition | `location_embeddings` (pgvector), room entities, `room` corrections |
| Passive memory | `passive` source with low base confidence, private zones, `passiveMemory` setting (off), consent language |
| Trackers / glasses | `tracker` source, device ids on observations, provider-agnostic `VisionProvider` path |
| Decluttering | `notSeenSince`, `mostMoved`, `awayFromUsual` queries |
| Anti-duplicate shopping | `inventory` intent + matching against a captured product photo (same pipeline) |
