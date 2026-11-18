# Adopting v0.3, a step at a time

The v0.3 rules ship as `0.3.0`, a minor release of the package, and leave `sources.contractVersion` at 1 ([#45](https://github.com/we-the-rebel-alliance/source-contract/issues/45)). Every field it adds is optional: a v0.2 plugin passes the kit as it is, and every v0.2 recorded fixture passes unchanged. So adopt one step at a time, and keep `npm run check` green after each.

**Order.** A consumer (Memory, jelly) re-vendors first. A consumer on 0.2.x refuses a page that carries a new page field, a descriptor that declares `facts`, `hints` or `routines`, and any new key at all, because its schemas are strict. Pin `#v0.3.0` there, run its own checks, and only then send the first new field. This is the order `removals[]` took.

**What is here.** The data model additions are in `events`; the descriptor keys are in the `sources` schema; the hint and routine formats are the `hints` module; and six checks join the kit (`hints`, `routines`, `actor-kind`, `facts`, `commitment-key`, `parts-stable`). The rules themselves are in [the contract](contract.md#l0-the-data-model) and [conformance](conformance.md#what-it-checks).

## Step 0: pin the package and prove nothing changed

```sh
npm install github:we-the-rebel-alliance/source-contract#v0.3.0
npm run check
```

The kit reports the six new checks as not applicable, because the source carries nothing for them yet, and the report stays ok. If a check applies, the page already carries the data it checks, so read on.

## Step 1: an actor says what it is

Set `kind` on every actor your plugin can recognise as an `agent`, a `bot` or a `service`:

```js
{ role: "agent", id: "slack:B0PILOT01", name: "Release bot", kind: "bot" }
```

`kind` is `person`, `agent`, `bot` or `service`. Absent means "not known to be one", never a confirmed person. A machine actor that says nothing is worse than no field at all, so send `kind` for every actor you know to be machine, and leave it out for a person you cannot confirm.

Then tell the kit which ids are machines, so it holds you to it:

```js
await sourceConformance({ ...options, machineActors: ["slack:B0PILOT01"] })
```

The `actor-kind` check fails an actor the fixture names there that carries no machine kind on a page listing it, and an id no page lists. It does not apply without `machineActors`.

## Step 2: identities say where each id comes from

An actor may carry up to 10 `identities`: another id for the same person, with where it came from.

```js
{
  role: "from",
  id: "mailto:sam.rivera@example.com",
  identities: [
    { id: "slack:U0PILOT01", strength: "strong", basis: "slack.profile.email" },
    { id: "gmail:reply-to", strength: "weak", basis: "gmail.header.reply-to" },
  ],
}
```

`strong` is for an authenticated source: the bound workspace's directory, a chat profile's email, a code host's verified email. `weak` is for what you observed: a `From` or `Reply-To` header, a display name, a signature. `basis` names the provider field, at most 64 characters. Only a strong identity merges people automatically; a weak one becomes a proposal the person confirms. An identity is never the actor's own `id`, and each is unique within its actor.

`self: true` is a hint that the actor is the signed-in person. Memory alone decides who the person is, so never treat `self` as the answer, and `self: false` only ever downgrades.

## Step 3: say who an item was for, and where it sits

- `reply_to`: the parent's `external_id`, or a source-scoped key such as `gmail-message:<Message-ID>`. At most 512 characters.
- `audience`: `dm`, `group`, `channel`, `email` or `public`. A work item visible to a team is `group`; a public place is `public`.
- `domains`: the recipients' lowercase domains, at most 20, for mail and shared channels.
- `thread`: already in v0.2, and normative for every source with conversations or series. Keep it stable across pages.

List what you know and leave the rest out. Whether an item was addressed to or mentions a person is Memory's decision from `to`, `cc`, `bcc`, `mentioned` and `audience: dm`; a plugin lists them and decides nothing.

## Step 4: long items and growing items

An event's own `text` stops at 4,096 characters. Two fields carry what is longer:

- `sections`, up to 20 `{ heading, text }`: meeting notes by heading, each text with its own 4,096 characters.
- `parts`, up to 50 `{ id, text, actor? }`: a growing item such as a session or a transcript. A part's `id` and `text` never change once listed, so a consumer may add only the new parts, and a re-listed item may list only its new parts. `actor` names an actor id on the same event.

The kit's `parts-stable` check holds a part id to its text across the pages of one run, which no single page can.

**Keep one event inside the source's `maxBytes`** (64 KB by default). A page always carries at least one event, so an event that alone is over the limit cannot be paged around and a consumer would refuse the page as `TOO_LARGE`. Twenty sections of 4,096 characters are about 80 KB, so list only the sections a reader needs, split long notes across pages, or cut each to the section that matters; for a growing item, list only the parts it has not listed yet. The kit's `event-within-max-bytes` names the event that is too large.

## Step 5: facts the source already holds in code

A fact is what your plugin knows from provider fields, never from free text: an issue's assignee, due date and state, a person's team from the directory, who attended a meeting. An event may carry up to 20.

1. **Declare the types** in the source's descriptor: `"facts": ["commitment"]`. An undeclared type fails the kit's `facts` check.
2. **Build them in code**, one of three core types:

```js
facts: [
  { type: "commitment", key: "issue-EX-1", title: "Send the report", owner: "linear:4f1c2e9a-0000-4000-8000-000000000001", due: "2026-11-30", state: "open", url: "https://linear.app/example/issue/EX-1" },
  { type: "person.attribute", actor: "slack:U0PILOT01", team: "Platform", role: "Engineer" },
  { type: "meeting.attended", actor: "slack:U0PILOT01", response: "accepted", organizer: false },
]
```

Every `owner`, `counterparty` and `actor` is an actor id on the same event. A `commitment.key` is a stable id within the source and account, from the provider's own id and never a counter, a position or a timestamp: two pages that list the same item must give the same key, and the kit's `commitment-key` check catches a key that moves. `person.attribute` takes at least one of `org`, `team` or `role`, from structured profile or directory data only.

Do not add a version, a `stated_by` or anything about a sensitive trait: the schema is closed, so any other field fails, and Memory stamps the installed package's version on each fact it files. Memory shows a fact as the source's ("Linear says"), never as the person's, and v0.3 has no plugin-defined type.

## Step 6: a hint file

A hint says how to read one kind of item, in at most 1,500 characters. Ship it in the package and declare it:

```json
"hints": ["hints/mail.md"]
```

```markdown
---
source: gws.gmail
kinds: [message]
produces: [commitment]
---
Owners are listed under "Action items" as "<name>: <task> (<date>)".
```

The frontmatter has `source` (one of your own source ids), `kinds` (at least one) and, optionally, `produces`. `produces` names a knowledge type Memory's core extractor finds — `commitment`, `decision`, `fact`, `preference`, `constraint`, `person` or `project` — and not a structured fact type: `person.attribute` and `meeting.attended` are values your code derives in `facts[]`, and a hint only helps Memory find knowledge. Memory ignores a type the person has not consented to, so naming one is safe before it is on.

The body is the guidance, and a hint is quoted inside Memory's prompt as data: it never decides how its text is used, whose word it states, where it lands, or what it costs. So `apply`, `stated_by`, `space`, `budget` and `priority` make the file invalid, as any other unknown key does.

Tell the kit how to read your files, and it checks each one:

```js
await sourceConformance({ ...options, files: (path) => readFileSync(join(here, path), "utf8"), ownSources: ["gws.gmail"] })
```

`ownSources` is every source id you declare; it defaults to the source under test. You can also check a file directly with `hintProblems(text, { sources })` from the `hints` module.

## Step 7: a routine, only later

A routine is for a meaning Memory's core extractor cannot find even with hints. Memory's first engine runs only its own core routines, with plugin hints and facts, so the format is defined now to be stable and a plugin should ship one only when a hint has proved insufficient.

```markdown
---
id: meeting-actions
title: Read the action items of a meeting
reads: { sources: [granola.meetings], kinds: [meeting] }
produces: [commitment]
---
Read the section headed "Action items" and answer one commitment for each owner and task.
```

`id`, `title`, `reads: { sources, kinds }` (your own sources only) and `produces` (the same seven knowledge types as a hint) are required, and the body holds at most 4,000 characters of instructions. A tier, a schedule, a budget, a priority, an apply mode, a `stated_by` or a namespace makes the file invalid: the namespace is the installed package's, and the rest are Memory's decisions. When routines do run, each runs alone on its own source and is propose-only.

## What Memory guarantees in return

- Memory alone decides who the person is, from the bound account's owner id and the identities the person confirmed.
- Only a strong identity merges people automatically, and a display name never does.
- An agent, a bot and a service never get a person page, and their text is never the person's word.
- A hint is data, and one model call holds one source's items only.
- A fact is shown as the source's, and changes only records keyed in its own source.
- A changed digest or plugin version makes that plugin's output propose-only until the person confirms it, and a new source, fact type or file is off until they consent.
- A plugin never sets priority, budget, space, apply mode or `stated_by`.

If a step is not ready, stop before it: each one is optional, and a report stays ok with the later checks not applicable.
