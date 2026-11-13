# Statocyst copy guide

How we write about Statocyst, and why. Use this for the landing page, store listings,
release notes, the README and any public documentation.

The short version: **assume the reader knows how to listen to music, and nothing else.**
They may never have heard of Jellyfin, self-hosting, open-source licences, local-first
software or Android Auto. Define every term the first time it appears. Explain the water
theme instead of trusting it to explain itself.

## 1. Who we are writing for

Three readers arrive at the same page:

1. **The library owner.** They have a folder of MP3s or FLACs and a music app that keeps
   trying to sell them something. They do not know the phrase “local-first”.
2. **The Jellyfin user.** They run a server, know what a library scan is, and want to know
   whether Statocyst talks to a stock server without a plugin.
3. **The curious visitor.** They saw a screenshot, like the look of the app, and need to
   understand what it actually does before downloading a file from GitHub.

Write so the first reader can follow, the second reader can verify, and the third reader
knows what to do next. Do not write only for the second reader. The project’s own
vocabulary is not the reader’s vocabulary.

## 2. Voice rules

- **Plain before poetic.** A metaphor is allowed after the plain sentence, not instead of it.
- **Define on first use.** If a sentence needs Jellyfin, “local-first”, “queue”, “sideload”
  or “checksum” to make sense, define it in the same paragraph or link to the definition.
- **Say what it replaces.** “No account with us” is clearer than “accountless”. “Your own
  server” is clearer than “self-hosted infrastructure”.
- **Be specific about what leaves the device.** “Nothing leaves your device” is false once a
  Jellyfin request, podcast search or artwork lookup happens. Name the exceptions.
- **No invented audio claims.** We do not claim gapless, bit-perfect, high-resolution or
  “deeper” sound. “Depth” is a navigation and design metaphor, not a fidelity claim.
- **Honest about limits.** Unsigned builds, sideloads, the Linux reference target and the
  constructed car preview are part of the story. Say them before the download button, not
  after a complaint.
- **No internal nouns in public copy.** “Authoritative queue”, “session”, “catalog”,
  “enclosure”, “WebView”, “cold start”, “content provider” and “DMA” belong in engineering
  documents, not on the landing page.
- **Pick one spelling per surface.** The landing page uses British spelling (`licence`,
  `favourites`, `catalogue`). The app strings and the Play listing use US spelling
  (`license`, `favorites`). Do not mix `favourites` and `favorites` in the same document.

## 3. The words we have to explain

| Word | What it actually means | How to say it to a newcomer |
| --- | --- | --- |
| **Statocyst** | The balance organ in a jellyfish: a small stone in a fluid-filled sac that tells the animal which way is up. | “Named after the jellyfish’s balance organ. It is the part that keeps its bearings, not the part that stings.” |
| **Local-first** | The library index, queue, favourites and playback state live on the device. There is no developer-run cloud library or account. | “Your device holds the original. We do not keep a copy of your library.” |
| **Jellyfin** | Free, open-source media-server software that a user runs on their own hardware. It indexes media and serves it to client apps. | “Your own private streaming service. You run the server; Statocyst is one of the players that can talk to it.” |
| **Queue** | The ordered list of what plays next, plus the current item and position. | “The list of what plays next. We save it as you edit it, so it is still there after you close the app.” |
| **Depth / every depth** | A water-column design motif and a way to describe reach across screens and sources. | “Every screen and every source you own — not a claim about audio quality.” |
| **Open source / MIT** | The source is public and the MIT licence lets anyone use, copy, modify and share it, provided the copyright notice stays. | “You can read it, build it, change it and keep it. No one can take the app away from you.” |
| **Sideload** | Installing an app file directly instead of through an app store. | “You install the file yourself. It is not from the App Store or Google Play yet.” |
| **Checksum / SHA-256** | A fingerprint calculated from a file. If the file changes, the fingerprint changes. | “A fingerprint for the download. Compare it with the one on the release page if you want to check the file arrived intact.” |
| **Direct play** | Jellyfin serving the original file rather than converting it first. | “Your server sends the original file when it can; otherwise it can convert it for the connection.” |
| **WebView** | The embedded browser an app can use to draw its interface. | “The part of the app that draws the screen. The car does not need it to browse.” |
| **Android Auto** | The in-car version of Android, shown on the dashboard head unit. | “The screen in your car. Statocyst gives it its own media service so it can browse without opening the phone app.” |
| **Head unit** | The dashboard screen and controls in a car. | “The screen in your dashboard.” |
| **Feed URL** | The address a podcast publishes its episode list at. | “The address a show publishes its episodes at. You do not need to find or paste it.” |
| **Enclosure** | The media file attached to a podcast episode. | “The audio or video file for an episode.” |
| **Catalog** | Our internal word for the indexed list of albums, artists and tracks. | “Your library.” |

## 4. The water theme, explained

The theme is not a generic “deep sea” skin. It comes from the name:

- A **statocyst** is a real organ. The word comes from Greek: *statos* (standing) and
  *kystis* (sac). It is a tiny mineral stone suspended in a fluid-filled sac. When a
  jellyfish tilts, the stone presses on sensitive hairs and the animal knows which way is
  up. It is a balance organ, not an eye or an ear.
- That is the product promise: a small instrument that helps you keep your bearings in a
  large library. The app is named after the part of the jellyfish that knows where it is,
  not the part that stings.
- The visual language follows the same idea. The page is a water column: surface at the
  top, twilight in the middle, midnight at the bottom, then a sand shelf where you can
  download something. Depth markers are a reading aid. They are not decibels, bit depth or
  a measure of how “deep” the music is.
- The app icon keeps the jellyfish silhouette, the suspended pearl and the sonar lines.
  The landing page extends that icon rather than inventing a second brand.

When we use “depth”, always make the frame clear. “Every depth” means **every screen and
every source you own**. It does not mean high-resolution audio, a bass setting, or a
“deep cuts” recommendation feature.

## 5. The ownership story, explained

Open source is not a badge in the footer. It is the reason the rest of the page can be
checked. The project started as a personal library player, not a streaming product: play
the files and the server we already had, on every screen we use, without an account in the
middle.

- **Your files stay yours.** Statocyst does not host, sell or re-license music. It plays
  files you already have.
- **Your server stays yours.** Jellyfin is software you run. Statocyst talks to the address
  you enter; we do not proxy or mirror your library.
- **There is no account with us.** No sign-up, profile, advertising ID or analytics account.
  Your Jellyfin login goes to your server.
- **The app is yours to keep.** MIT lets anyone read, build, modify and share the code. If
  the maintainers stop, someone else can continue.
- **You can check the download.** Every release carries SHA-256 checksums. A checksum is a
  fingerprint, not a signature; it proves the file arrived intact, not who built it.
- **The limits are stated.** Unsigned desktop builds, sideloaded mobile builds, the Linux
  reference target and the constructed Android Auto preview are all disclosed in public.

Use “open source” and “MIT” as facts, then explain the practical consequence in the next
sentence. Do not assume the reader knows what a licence is.

## 6. Replacements

| Instead of | Write |
| --- | --- |
| “Local-first, Jellyfin-oriented music player” | “A music player for your own files and your own Jellyfin server.” |
| “Authoritative queue” | “The saved queue is the source of truth.” |
| “Catalog sync” | “Copies the list of albums, artists and tracks to your device.” |
| “Direct play” | “Plays the original file when your server and connection allow it.” |
| “WebView cold start” | “Without waiting for the phone app to open.” |
| “Audio and video enclosures” | “Audio and video episodes.” |
| “Standard server login” | “Your normal Jellyfin address and account.” |
| “Sideloaded ad-hoc IPA” | “An iOS app file you install yourself with your own signing identity.” |
| “Constructed Android Auto preview” | “A reconstruction, not a photo of a real dashboard.” |
| “Every depth” with no context | “Every screen and every source you own.” |

## 7. Checklist before publishing

- [ ] Every product-specific term is defined before or where it is used.
- [ ] The reader can tell whether Jellyfin is required. (It is not.)
- [ ] The reader can tell what leaves the device and when.
- [ ] No sentence claims offline Jellyfin playback unless it is a downloaded copy.
- [ ] “Depth” is explained wherever the tagline appears without the page around it.
- [ ] The water theme is tied to the name and the balance-organ idea, not just “deep”.
- [ ] Open source is explained as a practical right, not a slogan.
- [ ] Limits are stated before the download action.
- [ ] A button labelled Download starts a download; it does not silently scroll to
      another section.
- [ ] If a download can stall or be blocked, the release page is offered as a visible
      fallback.
- [ ] Version numbers in body copy use the build token or no version at all.
- [ ] Store descriptions use the same definitions as the landing page.

## 8. Where this copy lives

| Surface | File |
| --- | --- |
| Landing page | `site/index.html` |
| Landing-page plan | `docs/marketing/landing-page-plan.md` |
| Google Play listing | `store/en-US/full_description.txt`, `store/en-US/short_description.txt` |
| Privacy policy | `docs/privacy-policy.md` |
| Repository introduction | `README.md` |
| Social card | `tools/make-site-og.py` → `site/assets/branding/og.jpg` |
| Store feature graphic | `tools/make-store-graphics.py` → `store/graphics/feature-graphic-1024x500.png` |
