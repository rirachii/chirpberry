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

The production hosting route is GitHub Pages at https://rirachii.github.io/chirpberry/.
Pages is configured to use GitHub Actions. `.github/workflows/pages.yml` runs only by manual dispatch on `main` in `rirachii/chirpberry`; pushes and pull requests do not deploy production.
It builds with `npm run build --prefix site -- --base /chirpberry/` and uses pinned official Pages actions.
Before uploading or deploying the site, `python3 scripts/verify-public-release.py --html site/dist/index.html` checks the built page's version, both DMG links, and Homebrew commands against the app and site versions.
It fetches the public versioned `release.json`, the canonical `rirachii/homebrew-tap` cask at `Casks/chirpberry.rb`, and the actual DMG without authentication, then requires matching version, URL, architecture, macOS requirement, and SHA-256.
The cask must use explicit scalar `version`, `sha256`, and `url` declarations; `#{version}` interpolation in the URL is supported. Missing artifacts, mismatches, or certificate errors stop deployment.
Complete native/provider acceptance and publish the verified release and cask before manually dispatching the Pages workflow. Preparing this workflow does not publish the website.

Vercel remains optional: use a separate project with Root Directory `site` and production branch `main`, and keep automatic production deployments disabled until the same release checks pass.
The current Vercel CLI route is blocked by an untrusted corporate proxy certificate. Do not disable TLS verification or bypass the proxy's trust requirements.
Run Vercel CLI commands from the repository root, where `.vercelignore` limits uploads to website source.
Verify desktop and mobile layouts, keyboard access, reduced motion, copy failure, and the real download after deployment.
