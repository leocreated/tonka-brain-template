# The per-clone pre-commit hook

## What it does

`system/hooks/pre-commit` runs `node system/bin/brain.mjs hook pre-commit`, which blocks a commit if staged content looks like a secret, a push destination is not proven or attested private, staged records are invalid, or the staged index does not match the staged records. Every check reads the staged snapshot that would be committed, not the working copy. Details: `system/docs/privacy.md`.

If you stage only part of your changes, the staged index must describe the staged records. Either stage the records the rebuilt index lists, or set the other changes aside first (for example `git stash push --keep-index`), run `node system/bin/brain.mjs index`, stage the index, commit, and restore them.

## Hooks are per clone

Git does not copy hook settings when you clone. Every device (and every separate clone) enables the hook itself:

```sh
node system/bin/brain.mjs hooks status
node system/bin/brain.mjs hooks install
```

`install` sets `core.hooksPath=system/hooks` in this clone's local git config (`.git/config`) only. It never changes your user-level or system-level git configuration. Git worktrees of the same clone share that local config, so one install covers them.

## When you already have hooks

`install` refuses to replace anything. It reports a conflict when:

- `core.hooksPath` is already set at any level (for example a global hooks folder or a hook manager), or
- a `pre-commit` file already exists in the default `.git/hooks/` folder.

Compose instead: add this line to your existing pre-commit hook (POSIX sh, which Git for Windows also uses):

```sh
node "$(git rev-parse --show-toplevel)/system/bin/brain.mjs" hook pre-commit || exit 1
```

After that, `hooks status` reports `composed`. With a hook manager, add the same command as a pre-commit step in its configuration.

## Uninstall

`node system/bin/brain.mjs hooks uninstall` removes `core.hooksPath` from this clone only, and only if it is the TONKA value.

## Notes

- The hook needs `node` on the PATH that git uses. Some graphical git clients use a reduced PATH; if the hook says node was not found, start the client from a terminal or fix its PATH. The hook fails closed: it blocks the commit rather than skipping checks.
- `git commit --no-verify` skips all hooks. Use it only deliberately.
- On a brand new clone, the guard asks for a visibility check first: `node system/bin/brain.mjs setup visibility` (or `join`).
