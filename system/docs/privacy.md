# Privacy

TONKA has two separate privacy workflows with different jobs. Do not confuse them.

| | Personal brain guard | Maintainer release check |
| --- | --- | --- |
| Who | Anyone using a brain | People publishing the public template |
| Allows personal prose | Yes, it is your private brain | No personal records at all |
| Scans | Every staged blob (what will be committed) | Every file in an exported tree, including hidden files and file names |
| Command | `brain guard` (and the pre-commit hook) | `brain release-check --root <export>` |

## Personal brain guard

The pre-commit hook (`brain hook pre-commit`) blocks a commit when:

1. **Staged content looks like a credential.** It reads the staged blobs from the git index, not your working tree, so what is checked is exactly what would be committed. Text is decoded as UTF-8 or UTF-16 (with or without a byte order mark); binary blobs are scanned as raw bytes too. Rules cover private key blocks, cloud and code-host access tokens, common AI provider API keys, chat webhooks and tokens, payment live keys, package registry tokens, JSON Web Tokens, passwords embedded in URLs, and `secret = <long random value>` style assignments.
2. **A file name suggests a secret store**: `.env` files (except `.env.example`, `.env.sample`, `.env.template`), private key files, keystores, password databases, `.npmrc`, `.netrc`, cloud credential files and similar.
3. **A symlink or submodule is staged.**
4. **A push destination is not proven or attested private.** On every commit the guard checks each github.com push destination live with gh. A public or internal result blocks at once, whatever was recorded before. See "Visibility proof versus attestation" below.
5. **Staged records have invalid frontmatter, or the staged index does not match the staged records.** Like the credential scan, these checks read what is staged, not your working copy: fixing a file on disk without restaging it does not count, and an index rebuilt from unstaged changes is reported as out of date. The guard never stages anything for you.

Findings show the file, line and rule name. The matched text is never printed.

### What the guard does not do

It is a heuristic. It cannot recognize every secret format, a password written as an ordinary word, or sensitive personal facts in prose. It does not scan history that is already committed (use `brain guard --all` for the current index). It is a safety net, not a substitute for not pasting secrets into notes.

### Visibility proof versus attestation

TONKA looks at every place a push from this clone can go: every push URL of every remote (an explicit `pushurl`, several of them, or the fetch URL when there is none), after `url.<base>.insteadOf` and `pushInsteadOf` rewrites, plus a URL named directly in `remote.pushDefault` or a branch's push settings. `brain setup visibility` lists them by remote name. Embedded user names, passwords and URL details are never printed or saved; `.brain/visibility.json` keeps only a fingerprint of the set, a short label for each destination, and the owner/repo name of any GitHub repository gh has reported public or internal.

- **Live proof**: gh reports a github.com destination as private (`gh repo view github.com/<owner>/<repo>`). Each destination is checked separately; one private repository proves nothing about another.
- **Public or internal**: any destination that gh reports as public or internal fails the gate immediately, even if an earlier check or attestation said private. That result revokes the earlier attestation and cached private proof for good. TONKA remembers it for that GitHub repository, whichever URL or destination set reaches it, and keeps blocking while gh cannot check it again (offline, signed out, not installed). Only a later live check that shows the repository private clears it. An attestation cannot override it, old or new.
- **Attestation**: a destination gh cannot check (another host, a local or network path, or gh not installed, signed out or offline with no recent proof) needs your explicit confirmation: `brain setup visibility --attest-private`. It is recorded as an attestation, never as proof, and covers exactly the destinations listed when you gave it.
- **Changes need a new decision**: proof and attestation are bound to the exact destination set. Adding a remote, or changing a remote URL or push URL, makes both stop counting until a new check passes or you attest again. Returning to an earlier set does not bring back its old attestation or proof.
- **Offline**: if gh cannot reach GitHub, the guard may rely on the last live private proof for up to 7 days, only for the identical destination set, and always says it is cached/offline evidence rather than a current live check.
- A push to a URL typed on the command line (`git push <url>`) is not a configured destination and cannot be checked in advance. Push your brain only to its own private remotes.

### Agent-native memory

Some agents store memory outside this repository, under their own settings. The guard and the memory policy cover the brain only. Review your agent's own memory settings separately; TONKA never changes them.

## Maintainer release check

Used before publishing the template. Run it on the exact exported tree:

```sh
node system/bin/brain.mjs release-export --out ../tonka-export
node system/bin/brain.mjs release-check --root ../tonka-export --denylist ~/private-terms.txt
```

It fails on: symlinks or special files, binary files (v1 ships text only), non-UTF-8 text, credential shapes, forbidden file names, email addresses other than the project's no-reply address and reserved example domains, personal home-directory paths, em dashes in prose, any record inside the compartments other than their README, local `.brain/` state, an index that is not the empty generated index, missing required files, a license other than MIT by TONKA contributors, and any difference from the strict template manifest.

The optional `--denylist` file holds extra terms (names, organizations, device labels) that must never appear. Keep it outside the repository; the check refuses a denylist inside the tree it checks, and reports matches by term number only, so the list itself is never printed or committed.

The release check is heuristic too. Before publishing, read the exported tree yourself, including hidden files.
