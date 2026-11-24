# Configuration

The options and their defaults, generated from `capabilities.options`.

<!-- generated:configuration -->
| Option | Type | Default | Description |
|---|---|---|---|
| `access` | `all` \| `ask-changes` \| `read-only` | `"all"` | How much the plugin's methods may do. |
| `accounts` | object | — | One profile per account alias. |
| `allowUntestedHost` | boolean | `false` | Start outside the tested OpenCode range. |
<!-- /generated:configuration -->

## Example

```json
{ "access": "ask-changes", "allowUntestedHost": false }
```
