---
name: github
description: Read GitHub notifications, issues and commits as contract events, and pick the account to read. Use for GitHub activity; not for posting, commenting or changing anything.
---

# GitHub

Read the `github` account's activity with `tools.github.events_list`, and ask for detail one event at a time.

- Pick the account with `account` when the plugin serves more than one.
- The access setting decides what may run: `all`, `ask-changes` or `read-only`.
- `NEEDS_SIGN_IN` means the account is not signed in: run `opencode auth login github-<alias>`.
