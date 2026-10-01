# Updating the template

Your brain was created from a copy of the template, not a fork, so updates do not arrive through `git pull`. TONKA updates are manual, local and conflict-aware.

## How it works

`system/template-manifest.json` lists every template-owned file with a content hash (SHA-256; text files are hashed with Windows line endings normalized). It never lists your records, `INDEX.*` or `.brain/`.

An update compares three versions of each template file: the hash recorded when you installed (your current manifest), the file on disk now, and the file in the new release.

| Situation | Action |
| --- | --- |
| You never changed the file | Updated (backup kept) |
| You changed the file | Conflict: your version is kept, the new version is saved for you to merge |
| New file in the release | Added (or conflict if you already have a different file there) |
| You deleted a template file | Left deleted; the new version is saved for reference |
| File removed upstream, unchanged locally | Removed (backup kept) |
| File removed upstream, changed locally | Kept |
| A symlink in the path | Conflict, nothing written |

Your records are never read or written by the updater.

## Steps

1. Get the new release as a folder on your machine, from a source you trust. For example, download the release archive from the template's repository and extract it (`tar -xf <archive>` works on Windows, macOS and Linux), or clone the template at a release tag into a separate folder.
2. Commit or stash your own work first so the update is easy to review.
3. Dry run (the default; nothing is written):
   `node system/bin/brain.mjs update --from ../tonka-brain-template-1.1.0`
4. Read the plan. It prints the package manifest SHA-256 and every action.
5. Apply the safe changes:
   `node system/bin/brain.mjs update --from ../tonka-brain-template-1.1.0 --apply`
6. Review `git diff`, merge any conflicts using the saved copies, run `node system/bin/brain.mjs check`, and commit yourself.

Backups, the new versions of conflicted files and a receipt are kept in `.brain/updates/<timestamp>/` (ignored, this device only).

## What the updater checks before changing anything

- The release folder is separate from your brain.
- The manifest has a supported schema, the expected template name and a valid version. A downgrade needs `--allow-downgrade`.
- Every path is relative, stays inside the brain, has no `..`, drive letters, backslashes or reserved names, never targets `.git`, `.brain`, records, `INDEX.*` or the manifest itself, and is unique (ignoring case).
- Every file in the release exists, is a regular file, contains no symlink in its path, resolves inside the release folder, and matches its manifest hash. A single failure aborts the whole update with nothing changed.

## Provenance: integrity is not identity

The manifest hash proves the files match the manifest, and `--manifest-sha256 <hex>` lets you require that the manifest itself matches a value you obtained separately (for example from release notes you trust). Neither proves who made the release. Choosing a trustworthy source is your decision. The updater never downloads anything and never runs code from the release; the updater already in your brain reads the release as data.

## Keeping old template code

You never have to update. An older brain keeps working with its own helpers. If you modified template files, updates keep your versions and show conflicts. If a future release changes the manifest schema, your current updater refuses it and tells you to follow that release's manual upgrade notes, so an old updater never misapplies a newer format.
