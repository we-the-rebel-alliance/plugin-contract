---
name: slack
description: Read Slack channels, threads and direct messages as contract events, and pick the workspace account. Use for Slack history; not for posting or changing anything.
---

# Slack

Read the confirmed channels with `tools.slack.events_list`, one thread with `tools.slack.read_thread`, and the channels a person may confirm with `tools.slack.list_user_channels`.

- Pick the account with `account` when the plugin serves more than one workspace.
- The access setting decides what may run: `all`, `ask-changes` or `read-only`.
- `NEEDS_SIGN_IN` means the workspace is not signed in: run `opencode auth login slack-<alias>`.
