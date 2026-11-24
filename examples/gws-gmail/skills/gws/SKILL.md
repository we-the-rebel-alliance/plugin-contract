---
name: gws
description: Read Gmail, Calendar and Drive as contract events, and pick the Google account to read. Use for mail, meetings and documents; not for sending or changing anything.
---

# Google Workspace

Read the chosen account with `tools.gws.events_list`, and one message's detail with `tools.gws.read_message`.

- Pick the account with `account` when the plugin serves more than one.
- The access setting decides what may run: `all`, `ask-changes` or `read-only`.
- `NEEDS_SIGN_IN` means the account is not signed in: run `opencode auth login gws-<alias>`.
