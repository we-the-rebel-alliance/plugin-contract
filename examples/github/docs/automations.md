# Automations

An events source is read with a cursor in OpenCode automation state. The suggested cadence is the
provider's floor, not a schedule the plugin sets.

<!-- generated:automations -->
| Source | Method | Provider floor | Suggested | Signals |
|---|---|---|---|---|
| `github.activity` | `tools.github.events_list` | — | 5 min | `bus` |
<!-- /generated:automations -->
