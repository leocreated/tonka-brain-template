# Releasing the template (maintainers)

This page is for people maintaining the public TONKA BRAIN TEMPLATE repository. Brain users do not need it.

## Before a release

1. Bump `version` in `package.json`.
2. Regenerate the manifest and index from the template tree:
   ```sh
   node system/bin/brain.mjs manifest --write
   node system/bin/brain.mjs index
   ```
3. Run everything:
   ```sh
   npm run verify
   ```
   This runs the tests, `check --strict`, `manifest --check --strict` and `release-check` on the working tree.
4. Commit.

## Check the exact exported tree

The working tree can contain files that are not committed. Check what will actually be published:

```sh
node system/bin/brain.mjs release-export --out ../tonka-export
node system/bin/brain.mjs release-check --root ../tonka-export --denylist ../private-terms.txt
```

- `release-export` writes the committed `HEAD` tree (not your working tree) into a new, empty folder outside the repository. It refuses symlinks and submodules.
- `release-check` scans every file in that folder, including hidden files and file names. See `system/docs/privacy.md` for the full list.
- The denylist is optional: a plain text file, one term per line, with names, organizations, device labels or paths that must never appear. Keep it outside both trees. Matches are reported by term number only.

Then read the exported tree yourself, including hidden files. The checks are heuristic.

## Publish

Publishing (creating the public repository's commit, tags and release archive) is a deliberate manual step. Publish from the checked export folder so no development history ships. In the release notes, include the SHA-256 of `system/template-manifest.json` so users can pass it to `brain update --manifest-sha256`.

## CI

`.github/workflows/template-ci.yml` runs `npm run verify` on Linux, Windows and macOS with Node 22 and 24. The job is skipped in private repositories, so brains created from the template do not run it.
