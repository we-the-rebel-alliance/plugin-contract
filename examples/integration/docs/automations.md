# Automations

An events source is read with a cursor in OpenCode automation state. The suggested cadence is a hint for the
automation, not a schedule the plugin sets.

<!-- generated:automations -->
| Source | Method | Provider floor | Suggested | Signals |
|---|---|---|---|---|
| `harbour.notes` | `tools.harbour.events_list` | — | 5 min | `bus` |
<!-- /generated:automations -->

## Reading with a cursor

Call `tools.harbour.events_list` with `{ "account": "work", "scope": { "spaces": ["space-research"] } }`, keep the
`cursor` it answers in automation state, and pass that cursor on the next run. The cursor never moves between accounts
or scopes.
