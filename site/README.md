# Legacy Chirpberry website draft

This preserved native marketing draft lives in this directory and has no backend, sign-in, analytics, or speech upload controls.
Its copy and download targets describe the preserved SwiftUI Mac app; [Electron candidate support](../desktop/README.md) is documented separately. The page remains a release draft until the [publication gates](../docs/releasing.md) are complete.
Run npm ci, npm run dev, and npm run build with Node 22.12 or later.
The development port is 5182 and the preview port is 4182.
The page uses Manrope under the SIL Open Font License and Lucide under the ISC license, with notices generated during the build.

Keep the app's free software license separate from Valsea's paid processing.
Advertise only implemented and verified capabilities.
The notebook illustration and language selector show clearly labelled example content, not a live API session.
Replace the product illustration with a verified native screenshot when that screenshot is available.
Both download anchors must target the same existing versioned DMG asset before production deployment.
Homebrew instructions must match the canonical rirachii/homebrew-tap cask.

The current public site at https://chirpberry.vercel.app uses a separate source checkout. Do not deploy this legacy draft over that project. See [public website ownership](../docs/releasing.md#public-website) before any deployment. If this draft is intentionally published separately, verify desktop/mobile layouts, keyboard access, reduced motion, copy failure, and the actual download.
