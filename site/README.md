# Chirpberry website

The static marketing site lives in this directory and has no backend, sign-in, analytics, or speech upload controls.
Run npm ci, npm run dev, and npm run build with Node 22.12 or later.
The development port is 5182 and the preview port is 4182.
Install the browser with `npx playwright install chromium`, then run `npm run test:e2e` for browser checks. To use an existing compatible browser executable, set `CHIRPBERRY_BROWSER` to its path.
When another checkout occupies the default port, use `CI=1 CHIRPBERRY_SITE_PORT=5187 npm run test:e2e` to require a fresh server from this checkout.
Set `CHIRPBERRY_TEST_EVIDENCE_DIR` to an existing evidence directory to retain full-page screenshots at the tested widths.
The page uses Manrope under the SIL Open Font License and Lucide under the ISC license, with notices generated during the build.

Keep the app's free software license separate from Valsea's paid processing.
Advertise only implemented and verified capabilities.
The notebook illustration and language selector show clearly labelled example content, not a live API session.
Follow the [design contract](../DESIGN.md) for replacing the product illustration.

For a local Pages build, run `npm run build --prefix site -- --base /chirpberry/` from the repository root.
Then run `npm run preview --prefix site -- --base /chirpberry/` and open `http://127.0.0.1:4182/chirpberry/` so the preview serves the same asset prefix.

The [release procedure](../docs/releasing.md#publish) owns production hosting, download/cask checks, the Pages deployment gate, Vercel setup, and post-deployment verification.
