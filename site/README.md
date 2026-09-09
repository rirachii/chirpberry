# Chirpberry website

The static marketing site lives in this directory and has no backend, sign-in, analytics, or speech upload controls.
Run npm ci, npm run dev, and npm run build with Node 22.12 or later.
The development port is 5182 and the preview port is 4182.
The page uses Manrope under the SIL Open Font License and Lucide under the ISC license, with notices generated during the build.

Keep the app's free software license separate from Valsea's paid processing.
Advertise only implemented and verified capabilities.
The notebook illustration and language selector show clearly labelled example content, not a live API session.
Replace the product illustration with a verified native screenshot when that screenshot is available.
Both download anchors must target the same existing versioned DMG asset before production deployment.
Homebrew instructions must match the canonical rirachii/homebrew-tap cask.

Deploy through a separate Vercel project with Root Directory set to site and production branch main.
Run CLI commands from the repository root, where .vercelignore limits uploads to website source.
Verify desktop and mobile layouts, keyboard access, reduced motion, copy failure, and the real download after deployment.
