---
name: glyph
description: Count words, keep a short note, and plan a write before committing it. Use it for tiny text jobs inside a session where no provider or sign-in is wanted.
---
# Glyph

Use Glyph for a small text job: count words, read a short note, or replace one. It needs no account and no provider.

## Reading

- `tools.glyph.word_count` takes `text` and answers `words` and `characters`.
- `tools.glyph.read_note` takes an `id`. An id that is not there is `INPUT_INVALID`; never treat a missing note as empty
  text.
- `tools.glyph.status` answers the plugin's state, its host range and an empty account list.

## Writing

A write is two calls, in order:

1. `tools.glyph.plan_write_note` with `{ id, text }` answers `{ planId, method, output, changes }` and writes nothing.
2. `tools.glyph.write_note` with `{ planId }` commits that plan. It takes no other input and no account.

Never invent a `planId`: plan again and use the new one. `PLAN_INVALID` means the plan is unknown or already used.

## Access levels

`all` runs the write, `ask-changes` asks first, and `read-only` turns it off. Reads always run.

## Errors

`INPUT_INVALID` means the input is not what the method describes, or the note id is unknown. `PLAN_INVALID` means the
plan is missing or spent: plan again. `PERMISSION_DENIED` means the person's access level or rules refuse the write.
