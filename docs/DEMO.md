# Shipaton demo (≈3 minutes)

Props: a passport, a blue pouch, a dresser drawer with sunglasses and a watch, and a box with headphones, a charger, a camera and an adapter. Use a dev build with Supabase and RevenueCat configured.

| # | Do | What the audience sees |
|---|---|---|
| 1 | Tap the ember **camera** button. Hold the mic: *"Remember where I'm putting my passport."* | The live transcript appears over the camera. |
| 2 | Photograph the passport going into the pouch in the open drawer. **Done.** | Real progress stages: *Preparing photos → Finding objects and where they are → Matching with your memory*. |
| 3 | Review screen. | **Passport → Blue document pouch → Top drawer → Black dresser → Bedroom.** The passport is auto-marked *sensitive*. Sunglasses are pre-unchecked ("also saw"). Tap a name to show *Actually…* corrections. **Remember.** |
| 4 | Camera → **Box** mode. Photograph the open box. | Headphones, charger, camera and adapter are detected. Pick *Electronics*. **Create Box 7.** |
| 5 | Result screen. | The QR label is shown. **Print / share label** produces a PDF generated offline. |
| 6 | Home → ask by voice: *"Where's my passport?"* | *"Last seen in the blue document pouch, in the top drawer of the black dresser, in the bedroom — today at 8:14 PM."* With the photo, the hierarchy tree and **High confidence**. |
| 7 | *"Where is my camera?"* | *"Last seen in Box 7, in Shelf B, in the storage room."* |
| 8 | Scan the box's QR label → **It's here now** → "Garage". | The box moves, and the camera's answer now follows the box to the garage. |
| 9 | Remove the pouch. Camera → **Scan area** → *Scan drawer*. Photograph the drawer. | **What changed:** *Still here: Sunglasses, Watch · Not detected this time: Blue document pouch.* A note explains that not being seen isn't proof something is gone. |
| 10 | Ask *"Where's my passport?"* again. | Confidence drops to **Low**, with the caveat: *"The blue document pouch it was in wasn't detected when you scanned the top drawer today… Its last confirmed sighting remains…"* The app is honest, not magical. |
| 11 | Tap **Show me** → scroll. | **Object journey** timeline with photos, "usual location", *This sighting was wrong / Delete permanently*. |
| 12 | **Spaces** tab. | The Memory Map: Home › rooms › furniture › compartments, with item counts. |
| 13 | Ask *"What changed in my bedroom this week?"* | The Pro paywall appears (smart questions). Real RevenueCat offering, price and trial terms from the dashboard. Purchase in sandbox → the question answers. |
| 14 | **You → Simple mode.** Ask *"Where are my glasses?"* | One big sentence plus the photo. Built for older adults and caregivers, as an organisational aid rather than a medical device. |

Talking points:

- AirTags answer *where is this tagged thing*. Physical Memory answers *where was this object last seen in my world*, with no hardware.
- Inventory apps are database-first. This is perception-first.
- The moat is each person's growing graph of objects, places, corrections and history, not a single model call.
