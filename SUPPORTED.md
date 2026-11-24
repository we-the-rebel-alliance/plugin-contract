# Supported plugins

The plugins that meet the plugin standard at this contract version. CI (`plugin-kit
supported`) reads each listed repository's manifest at the listed tag and runs the conformance kit against it. A plugin
that fails is marked `failing` until it passes again.

Contract: `plugin-contract` **v0.0.0**. OpenCode: **2.4.1**.

Legend:
- **Accounts:** `integration` (the plugin holds the credentials: one OpenCode integration per alias), `mcp` (the vendor's MCP
  server holds them: one server per alias), `local` (machine or OS user), `—` (signs in to nothing).
- **Today:** multi = several aliases at once already; single = one account.
- **Signals:** how a source can nudge: `bus` (`rpc.<name>.changed`), `webhook` (planned nudges).
- **Status:** `planned`, `in progress`, `supported`, `failing`.

## Data sources

| Plugin | Repository | Accounts (today → target) | Sources (kind: reads/output) | Write classes | Signals | Suggested cadence | Wave | Status |
|---|---|---|---|---|---|---|---|---|
| gws | `gws-plugin` | integration (multi → multi) | `gws.gmail` (events: message), `gws.calendar` (events: meeting), `gws.calendar.today` (snapshot: agenda), `gws.image` (snapshot: image), `gws.sheets` (snapshot: x-gws/sheet) | write, send, share, delete, export | bus; webhook later (Gmail Pub/Sub) | Gmail 2 min; Calendar 10 min | pilot | planned |
| slack | `slack-plugin` | mcp (single → multi) | `slack.workspace`, `slack.mentions` (events: message), `slack.dms` (snapshot: inbox) | write, send | bus; webhook later (Socket Mode) | 1 min | pilot | planned |
| x | `x-plugin` | mcp (single → multi) | `x.mentions`, `x.timeline` (events: message), `x.bookmarks` (events: bookmark), `x.bookmarks.list`, `x.posts` (snapshot: list); billed | send, write | bus | 5–15 min | pilot | planned |
| github | `github-plugin` | mcp (single → multi; `host` per profile) | `github.activity` (events: event), `github.notifications` (snapshot: list) | write, delete | bus | 2–5 min | A | planned |
| linear | `linear-plugin` | mcp (single → multi) | `linear.activity` (events: issue), `linear.issues` (snapshot: list) | write, delete | bus | 2–5 min | A | planned |
| jira | `jira-plugin` | mcp (single → multi; site per profile) | `jira.activity` (events: issue), `jira.issues` (snapshot: list) | write | bus | 5 min | A | planned |
| notion | `notion-plugin` | mcp (single → multi) | `notion.pages` (events: doc) | write, delete | bus | 10 min | A | planned |
| granola | `granola-plugin` | mcp (single server → multi) | `granola.meetings` (events: meeting), `granola.meetings.list` (snapshot: list) | write | bus; webhook later (`note.generated`) | 5 min | A | planned |
| wisprflow | `wisprflow-plugin` | mcp (single → multi) | `wisprflow.meetings` (events: meeting), `wisprflow.meetings.list` (snapshot: list) | — | bus | 5–10 min | A | planned |
| plaud | `plaud-plugin` | mcp (multi → multi) | `plaud.recordings` (events: meeting), `plaud.recordings.list` (snapshot: list) | export | bus | 10–15 min | A | planned |
| metaview | `metaview-plugin` | mcp (single → multi) | `metaview.conversations` (events: meeting) (to declare) | write, send | bus | 10 min | A | planned |
| ashby | `ashby-plugin` | mcp (single → multi) | `ashby.interviews` (events: meeting) | write, send | bus | 15 min | A | planned |
| affinity | `affinity-plugin` | mcp (single server → multi) | `affinity.meetings` (events: meeting), `affinity.companies` (snapshot: list) | write, delete | bus | 15 min | A | planned |
| elevenlabs | `elevenlabs-plugin` | mcp (single → multi; `region` per profile) | `elevenlabs.conversations` (events: session), `elevenlabs.conversations.list` (snapshot: list) | write, delete, send (calls), spend | bus; webhook later (post-call) | 2–5 min | A | planned |
| specter | `specter-plugin` | mcp (single → multi) | `specter.saved` (events: x-specter/company); metered | — | bus | daily | A | planned |
| bigquery | `bigquery-plugin` | integration (multi → multi) | `bigquery.jobs` (events: x-bigquery/job), `bigquery.saved` (snapshot: table) | write, admin | bus | while a job runs | B | planned |
| databricks | `databricks-plugin` | integration (multi → multi) | `databricks.queries`, `databricks.runs` (events), `databricks.saved` (snapshot: table) | write, admin | bus | while a run runs | B | planned |
| colab | `colab-plugin` | integration (multi → multi) | `colab.runs` (events: x-colab/run) (to declare) | write | bus | while a run runs | B | planned |

## Local sources

| Plugin | Repository | Accounts | Sources | Write classes | Wave | Status |
|---|---|---|---|---|---|---|
| boxd | `boxd-plugin` | local (boxd sign-in) | `boxd.works` (events: x-boxd/work), `boxd.works.list` (snapshot: list) | write, spend | C | planned |

## Tools only (no sources)

| Plugin | Repository | Accounts (today → target) | Write classes | Wave | Status |
|---|---|---|---|---|---|
| tavily | `tavily-plugin` | mcp (single → multi) | spend (credits) | C | planned |
| openrouter | `openrouter-plugin` | mcp (single → multi) | spend | C | planned |
| inference | `inference-plugin` | — (uses OpenRouter) | spend | C | planned |
| charts | `charts-plugin` | — | local (files) | C | planned |
| browse | `browse-plugin` | local (the person's browser) | write, send (via the page) | C | planned |
| utilities | `utilities-plugin` | — | local | C | planned |
| voice | `voice-plugin` | — | local | C | planned |

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

