# Main branch protection

Enabled September 12, 2026 at the owner's request for `rirachii/chirpberry`. GitHub's active [Protect main ruleset](https://github.com/rirachii/chirpberry/rules/23015530), ID `23015530`, targets exactly `refs/heads/main`. The intended configuration is tracked in [`.github/rulesets/main.json`](../.github/rulesets/main.json); GitHub settings enforce it, not the presence of this file.

## Enforced rules

- Changes must go through a pull request.
- Required `core` and `website` checks must come from the GitHub Actions integration (ID `15368`).
- The pull request must be up to date with `main` before merging.
- Review conversations must be resolved; new changes dismiss any prior approvals.
- Force pushes and deletion are blocked.
- The bypass list is empty, including for repository administrators and automation.
- Existing merge, squash, and rebase methods remain available.

Approving-review count is zero because the repository currently has one collaborator, `rirachii`. Pull requests and CI remain mandatory, but a second person's approval is not required. Revisit this setting when another maintainer is added. Do not add an admin or bot bypass to work around failing checks.

## CI scope

The required jobs are defined in `.github/workflows/ci.yml` and run for every pull request. `core` covers Swift core/MCP checks; `website` covers the legacy `site/` tests, build, and browser acceptance. The public Vercel website is maintained separately and is not verified by that job.

The Electron `notebook` matrix in `.github/workflows/desktop.yml` runs only when desktop, macOS, or that workflow changes. Its matrix jobs are not globally required by this ruleset, because path-skipped workflows would leave documentation-only pull requests waiting indefinitely. Contributors must still complete the applicable Electron matrix, local checks, and release acceptance required elsewhere in this repository. To make Electron CI a universal merge gate later, first provide an always-reported status that evaluates all relevant matrix results and safely handles unrelated changes.

## Verification and maintenance

After creation, GitHub reported `main.protected = true`, all four active rules applied to `main`, and no matching rules on an unrelated branch name. The `main` commit was unchanged by the settings update. The API returned the intended check names, trusted integration, strict policy, zero required approvals, and an empty bypass list. No force-push or deletion attempt was made against the live branch.

Read the live configuration before changing it:

```sh
gh api repos/rirachii/chirpberry/rulesets/23015530
gh api repos/rirachii/chirpberry/rules/branches/main
gh api repos/rirachii/chirpberry/branches/main --jq '{name, protected}'
```

Keep the tracked configuration and this document aligned with approved settings changes. If required check names or triggers change, coordinate their ruleset update so that a passing, up-to-date pull request can still merge. Changing this JSON alone does not update GitHub, and publication/real-device acceptance remain separate from branch protection.
