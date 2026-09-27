# Privacy policy (draft)

*Draft for the Shipaton build. Have it reviewed before any public release.*

Physical Memory helps you remember where your belongings are. That's sensitive: it describes your home. We treat it that way.

## What we collect

- **Photos you take** by pressing the shutter. Nothing is captured in the background.
- **What you say or type** while capturing or asking. Speech is transcribed on your device when supported.
- **Your memory:** objects, places, sightings, loans and trips you create.
- **Purchase status** from RevenueCat (whether Pro is active). We never see card details.
- **Anonymous usage counts** (for example "a scan was completed"), if you leave them on. Never object names, places, photos or text.

## Where it lives

- **On your phone first.** Your memory and photos are stored in the app's private storage.
- **Cloud analysis (optional, on by default, can be turned off):** the photos from a capture are sent over an encrypted connection to our server and on to our AI provider (Anthropic) to identify objects. Our server doesn't store them. Anthropic processes API data under its commercial terms, which don't permit training models on it by default. See anthropic.com/legal.
- **Cloud backup (optional, Pro):** your memory and photos are copied to your private account (Supabase). Access is restricted to your account by row-level security, and storage is encrypted at rest.

## Controls

- Turn cloud analysis off: nothing leaves the phone, and you label objects yourself.
- **Minimise people:** if a person appears in a photo, only object close-ups are kept.
- **Never read text:** the AI won't transcribe documents, cards or labels.
- **Sensitive objects** are blurred until tapped and excluded from shared views.
- **Private zones** exclude a room or drawer from shared views and from any future passive recognition.
- Delete a single sighting, a single object, all photos, or **everything**, including your cloud account.

## Sharing

We don't sell data. We don't use your photos for advertising. Service providers (Supabase, Anthropic, RevenueCat, and OneSignal if enabled) process data only to provide the service.

## Contact

Open an issue at github.com/ParishruthiGanesh/RevenueCat-Shipaton.
