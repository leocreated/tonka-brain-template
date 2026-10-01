# archives

Finished, fixed or superseded records. Archived records keep their history but leave the active index, so search stays focused.

- Archive with `node system/bin/brain.mjs archive <path> --status <done|resolved|superseded|archived>`.
  It moves the file to `archives/<same path>`, sets the final `status` and an `archived:` date, and rebuilds the index.
- For a replaced decision add `--superseded-by decisions/YYYY-MM-DD-new-one.md`.
- Search archives directly (for example with your editor or `git grep`) when history matters.
- Do not delete records to tidy up; archive them.
