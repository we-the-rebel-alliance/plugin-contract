# Decisions

The decisions that shape `plugin-contract` v0. Each is settled; none is open. The roadmap records the same decisions
in full.

## Contract decisions

- **D1: the repository and package are renamed.** `source-contract` becomes `plugin-contract`, and the package
  `@we-the-rebel-alliance/plugin-contract`.
- **D2: plugin repositories move with their history.** Each is transferred with its history, issues and redirects,
  renamed `<name>-plugin`, and its old releases and tags are then deleted.
- **D3: every default branch is `master`.** The 27 plugins already are; this repository moves from `main`.
- **D4: every package restarts at `v0.0.0`.** The first release in the new organisation is cut when the package meets
  the standard.
- **D5: boxd and voice stay; inference stays separate from openrouter; history is retired (LD-1).**
- **D6: `plugin-kit` ships inside `plugin-contract`.** It is a binary and a dev export, never bundled; `plugin-template`
  is its own repository.
- **D7: a fixed list does not migrate now.** It is mem, mem-deploy, messaging, evals, the app's model provider, hindsight,
  web-runtime, vps, release-rehearsal and every archived repository; history (LD-1) and jobs (LD-2) are retired.
- **D8: OpenCode 2.4.1.** Dev dependencies pin exactly `2.4.1`, the host range is `>=2.4.1 <2.5.0`, and `tested` is
  `[2.4.1]`; a later 2.4.x joins `tested` through the kit's `hosts` matrix.
- **D9: `catalog-plugin` comes in phase 6.** Every current consumer runs beside OpenCode and reads installed packages
  through the `catalog` module; the plugin is needed for the first remote app, and grants are keyed on `consumer`.
- **D10: the contract keeps generic `hints`.** Routines are one consumer's extraction engine, so they leave the
  contract and move into that consumer; `hints` stay for any model-based consumer.
- **D11: PR #49 was merged with no release.** The work stays in history, and phase 1.3 builds on it: `service` moves into
  the `capabilities` manifest with the same label rule, and its tests and pinned hashes carry over.

## Decisions of 24 November (lead)

- **LD-1: history is retired** (owner's decision). It is not migrated and there is no `history-plugin`;
  `joe-broadhead/opencode-history` is archived with its issues and pull requests closed, and `utilities-plugin` gains
  two session stopgaps in phase 4.
- **LD-2: jobs is retired** (owner's decision). `joe-broadhead/opencode-jobs` is archived; OpenCode automations replace
  it, and nothing migrates.
- **LD-3: the owner's plugin rules and owner table are in the plugin standard, §0.** T0 and T1 are hard gates on every
  pull request; the routing pack is not a gate until the evals HALT is lifted; no tool is pinned by default and no
  plugin adds per-request hooks.
- **LD-4: the local `chore/opencode-2.4.1` branches are not pushed.** Phase 4 rewrites each plugin from `master`, and
  the six OpenCode 2.4 behaviour changes become requirements for the kit's host harness (standard §8).
- **LD-5: "write and export tools never become RPC methods" is superseded.** A non-read method over RPC runs only with a
  permission ask or a valid action grant, and conformance refuses it otherwise (contract §8).
- **LD-6: gws keeps its per-class commit tools** and trims their descriptions; the audit's single merged commit tool is
  rejected because each method has one class and access is decided per class.
- **LD-7: nothing is filed upstream.** A hosted MCP server's text is countered in the connector's own namespace line.
- **LD-8: per-plugin phase 4 items stand.** boxd's skill becomes `boxd-sessions`; slack and tavily say "OpenCode
  automation", never "cron job"; charts unpins its five tools; boxd, colab and databricks drop their cost-line hooks.
- **LD-9: Frankfurt only.** Lanes and CI use `fra`, never `auto` or `nyc`.
