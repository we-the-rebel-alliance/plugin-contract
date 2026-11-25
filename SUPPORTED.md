# Supported plugins

The plugins in the programme, and whether each meets the plugin standard at this contract version. `plugin-kit
supported` prints a row from the plugin's manifest at the listed tag — repository, account mechanism, sources, write
classes, signals and suggested cadence — and a maintainer pastes it here; the accounts cell adds the programme's
`today → target` note in parentheses. `Wave` and `Status` are programme decisions rather than manifest data, passed as
`--wave` and `--status`.

`Status: supported` is the only claim that the listed tag passes `plugin-kit check` with a conformance report.
`planned` and `in progress` are not a conformance claim; `failing` means a tag that passed before no longer does. A
plugin that does not reach `supported` is not listed as supported under this contract version.

Contract: `plugin-contract` **v0.0.0**. OpenCode: **2.4.1** (`>=2.4.1 <2.5.0`; `tested: [2.4.1]`).

Legend:
- **Accounts:** the manifest's `accounts.via`: `integration` (the plugin holds the credentials: one OpenCode integration
  per alias), `mcp` (the vendor's MCP server holds them: one server per alias), `local` (machine or OS user), `—` (signs
  in to nothing). `(profile per alias)` when the manifest profiles each alias. The `(today → target)` part of the column
  is the programme plan, not manifest data.
- **Sources:** `<id> (events: <reads>)` or `<id> (snapshot: <output>)`, exactly the kit's cell; `—` for a tools-only
  plugin.
- **Write classes:** the method classes, in the contract's order: `write`, `send`, `share`, `delete`, `export`, `admin`.
- **Signals:** how a source can nudge — `bus` (`rpc.<name>.changed`), `mcp-events`, `webhook` — as the manifest declares
  them; a plugin lists only the ones it has.
- **Suggested cadence:** the smallest `suggestMinutes` in the manifest, as `2 min`, `1 hour` or `1 day`.
- **Status:** `planned`, `in progress`, `supported`, `failing`.

## Data sources

| Plugin | Repository | Accounts (today → target) | Sources (kind: reads/output) | Write classes | Signals | Suggested cadence | Wave | Status |
|---|---|---|---|---|---|---|---|---|
| gws | `gws-plugin` | integration (multi → multi) | `gws.gmail` (events: message), `gws.calendar` (events: meeting), `gws.calendar.today` (snapshot: agenda), `gws.image` (snapshot: image), `gws.sheets` (snapshot: x-gws/sheet) | write, send, share, delete, export | bus | 2 min | pilot | planned |
| slack | `slack-plugin` | mcp (single → multi) | `slack.workspace` (to declare), `slack.mentions` (events: message), `slack.dms` (snapshot: inbox) | write, send | bus | 1 min | pilot | planned |
| x | `x-plugin` | mcp (single → multi) | `x.mentions` (to declare), `x.timeline` (events: message), `x.bookmarks` (events: bookmark), `x.bookmarks.list` (to declare), `x.posts` (snapshot: list) | write, send | bus | 5 min | pilot | planned |
| github | `github-plugin` | mcp (single → multi; `host` per profile) | `github.activity` (events: event), `github.notifications` (snapshot: list) | write, delete | bus | 2 min | A | planned |
| linear | `linear-plugin` | mcp (single → multi) | `linear.activity` (events: issue), `linear.issues` (snapshot: list) | write, delete | bus | 2 min | A | planned |
| jira | `jira-plugin` | mcp (single → multi; site per profile) | `jira.activity` (events: issue), `jira.issues` (snapshot: list) | write | bus | 5 min | A | planned |
| notion | `notion-plugin` | mcp (single → multi) | `notion.pages` (events: doc) | write, delete | bus | 10 min | A | planned |
| granola | `granola-plugin` | mcp (single server → multi) | `granola.meetings` (events: meeting), `granola.meetings.list` (snapshot: list) | write | bus | 5 min | A | planned |
| wisprflow | `wisprflow-plugin` | mcp (single → multi) | `wisprflow.meetings` (events: meeting), `wisprflow.meetings.list` (snapshot: list) | — | bus | 5 min | A | planned |
| plaud | `plaud-plugin` | mcp (multi → multi) | `plaud.recordings` (events: meeting), `plaud.recordings.list` (snapshot: list) | export | bus | 10 min | A | planned |
| metaview | `metaview-plugin` | mcp (single → multi) | `metaview.conversations` (events: meeting) (to declare) | write, send | bus | 10 min | A | planned |
| ashby | `ashby-plugin` | mcp (single → multi) | `ashby.interviews` (events: meeting) | write, send | bus | 15 min | A | planned |
| affinity | `affinity-plugin` | mcp (single server → multi) | `affinity.meetings` (events: meeting), `affinity.companies` (snapshot: list) | write, delete | bus | 15 min | A | planned |
| elevenlabs | `elevenlabs-plugin` | mcp (single → multi; `region` per profile) | `elevenlabs.conversations` (events: session), `elevenlabs.conversations.list` (snapshot: list) | write, send, delete | bus | 2 min | A | planned |
| specter | `specter-plugin` | mcp (single → multi) | `specter.saved` (events: x-specter/company) | — | bus | 1 day | A | planned |
| bigquery | `bigquery-plugin` | integration (multi → multi) | `bigquery.jobs` (events: x-bigquery/job), `bigquery.saved` (snapshot: table) | write, admin | bus | — | B | planned |
| databricks | `databricks-plugin` | integration (multi → multi) | `databricks.queries` (to declare), `databricks.runs` (events: to declare), `databricks.saved` (snapshot: table) | write, admin | bus | — | B | planned |
| colab | `colab-plugin` | integration (multi → multi) | `colab.runs` (events: x-colab/run) (to declare) | write | bus | — | B | planned |

## Local sources

| Plugin | Repository | Accounts (today → target) | Sources (kind: reads/output) | Write classes | Signals | Suggested cadence | Wave | Status |
|---|---|---|---|---|---|---|---|---|
| boxd | `boxd-plugin` | local | `boxd.works` (events: x-boxd/work), `boxd.works.list` (snapshot: list) | write | bus | — | C | planned |

## Tools only (no sources)

| Plugin | Repository | Accounts (today → target) | Sources (kind: reads/output) | Write classes | Signals | Suggested cadence | Wave | Status |
|---|---|---|---|---|---|---|---|---|
| tavily | `tavily-plugin` | mcp (single → multi) | — | — | — | — | C | planned |
| openrouter | `openrouter-plugin` | mcp (single → multi) | — | — | — | — | C | planned |
| inference | `inference-plugin` | — (uses OpenRouter) | — | — | — | — | C | planned |
| charts | `charts-plugin` | — | — | write | — | — | C | planned |
| browse | `browse-plugin` | local (the person's browser) | — | write, send | — | — | C | planned |
| utilities | `utilities-plugin` | — | — | write | — | — | C | planned |
| voice | `voice-plugin` | — | — | write | — | — | C | planned |

## Not on the contract

| Repository (today) | Why |
|---|---|
| `opencode-mem`, `opencode-mem-deploy` | a consumer and its own service, not a plugin on this standard for now |
| `opencode-messaging` | not needed now |
| `opencode-evals` | tooling, not a plugin on this standard |
| `opencode-history` | retired and archived (owner, 24 Nov): OpenCode's session tools replace it, and `utilities-plugin` carries two stopgaps until OpenCode covers the rest |
| `opencode-jobs` | retired and archived (owner, 24 Nov): OpenCode automations replace its scheduler; nothing to migrate |
| an app's own model provider | owned by that app, in its own repository |
| `opencode-hindsight`, `opencode-web-runtime`, `opencode-vps` | not plugins on this standard |
| `opencode-release-rehearsal` | replaced by `plugin-kit release --dry-run` |
| every `*-archive` and archived repository | archived; not migrated |

