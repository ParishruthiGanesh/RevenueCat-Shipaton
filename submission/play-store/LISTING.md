# Google Play listing: Physical Memory

Paste into **Play Console → Grow → Store presence → Main store listing**.

## App name (max 30 characters)
Physical Memory: Find Things

## Short description (max 80 characters)
Show it where you put something. Ask later. It shows you where it was last seen.

## Full description (max 4000 characters)
Your phone remembers every photo you've taken, but not where you put your passport. Physical Memory does.

**SHOW IT ONCE**
Point your camera and say "Remember where I'm putting my passport." Physical Memory works out the object and exactly where it's going: the blue pouch, in the top drawer, of the black dresser, in the bedroom. No tags to buy. Nothing to type.

**ASK FOR IT LATER**
"Where's my passport?"
"Last seen in the blue document pouch, in the top drawer of the black dresser, in the bedroom. Sunday, 8:14 PM."
Every answer shows the photo that proves it, and how confident it is.

**HONEST, NOT MAGIC**
Physical Memory never pretends to know where something is. It tells you where it was last seen. If you rescan a drawer and something's missing, confidence drops and it tells you why. If it can't tell two similar chargers apart, it asks you instead of guessing.

**FEATURES**
• Hold to scan: sweep across a shelf and see what's new, what moved and what's missing
• Storage boxes with printable QR labels. Scan a label to see what's inside
• Rooms, furniture, drawers and boxes, mapped the way your home actually is
• Object history: everywhere something has been, and where you usually keep it
• Lending: "I lent my camera to Sarah"
• Travel mode: know what's packed because the camera saw it in the bag
• Zoom into any photo to check the details
• Simple Mode, large text, high contrast and voice input

**FAMILY**
Create a family with Pro. Everyone else joins free with a code. Share your home and ask "Where did Dad put the drill?" Sensitive items like passports and medication, and any room you mark private, are never shared.

**PRIVATE BY DESIGN**
• Your memory lives on your phone first
• People are cropped out of photos automatically
• Passports, IDs and medication are blurred and never read
• Turn cloud AI off at any time
• Delete anything, including your whole account

**PHYSICAL MEMORY PRO**
Start with a free trial. Pro unlocks unlimited items and AI scans, full history, smart questions, travel mode, cloud backup and creating a family. Cancel anytime in Google Play.

Physical Memory is an organisational aid, not a medical device.

## Category
- App category: **Productivity**
- Tags: Organizer, Home, Productivity

## Contact details
- Email: parishruthig2@gmail.com
- Website: https://github.com/ParishruthiGanesh/RevenueCat-Shipaton

## Privacy policy URL
https://github.com/ParishruthiGanesh/RevenueCat-Shipaton/blob/main/docs/PRIVACY.md

## Graphics (all in this folder)
| Asset | File | Required size |
|---|---|---|
| App icon | `icon-512.png` | 512×512 |
| Feature graphic | `feature-graphic.png` | 1024×500 |
| Phone screenshots | `phone-1.png` … `phone-5.png` | 1080×1920 |

## App content answers
- **Ads:** No
- **Target audience:** 18+ (avoids the extra requirements for apps aimed at children)
- **Content rating questionnaire:** Utility/Productivity. No violence, no user-to-user public content. Family sharing is private and invite-only.
- **Data safety:**
  - Collected: email (account), photos (app functionality), purchase history (via Google Play / RevenueCat), user ID
  - Encrypted in transit: Yes
  - Users can request deletion: Yes (in-app account deletion)
  - Shared with third parties: photos are sent to an AI provider for analysis only when cloud AI is on. Processing only, not sold.
- **Account deletion URL:** the same privacy policy link (it describes in-app deletion)
- **Financial features:** None

## Before a real Play Store release
1. Create a Google Play Developer account ($25 one-time) and complete identity verification.
2. In RevenueCat, add the **Google Play** app and replace the Test Store key with the real `goog_…` key in EAS env (production). Never ship the Test Store key.
3. Create the subscription in Play Console (same product id as RevenueCat) and attach it to the `physical_memory_pro` entitlement.
4. Build: `npx eas-cli@latest build -p android --profile production` (produces an .aab).
5. Upload it to **Closed testing**. New personal accounts need **12 testers for 14 days** before Production access.
6. Apply for Production. Review usually takes a few days.
