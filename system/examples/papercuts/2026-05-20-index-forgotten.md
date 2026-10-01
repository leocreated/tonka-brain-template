---
title: Index forgotten after adding records
date: 2026-05-20
status: resolved
tags: [index, habits]
summary: Fixed by the pre-commit hook index check
example: true
---
# Index forgotten after adding records (fictional example)

Fictional example papercut.

## Friction

New records were committed without rebuilding the index, so search missed them.

## Workaround

Run `node system/bin/brain.mjs index` before committing.

## Fix

Installed the per-clone pre-commit hook, which blocks commits with a stale index. Archived after a month without repeats.
