# Changelog

Releases are tagged GitHub releases, not npm: pin `github:we-the-rebel-alliance/plugin-contract#v<version>`. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/)
as it applies before 1.0: while `0.x`, a minor release may break, so plugins and apps pin exact tags and move together.

## 0.0.0 (unreleased)

The first release in `we-the-rebel-alliance`: the contract at wire version 1, greenfield, with no compatibility path to
`source-contract` v0.x.

- **The contract and the standard:** `docs/contract.md` and `docs/plugin-standard.md`, with the settled decisions in
  `docs/decisions.md` and the plugin list in `SUPPORTED.md`.
- **The modules:** `manifest`, `accounts`, `access`, `register`, `events` (event model, hash, screening, page checks),
  `cursor` (a bound cursor codec), `outputs` (the snapshot shape registry), `params` and `pick`, `read` and `act`, `bus`,
  `grant`, `catalog`, `hints`, `schemas` and `conformance`.
- **`act` on a plan:** a preview calls the action's `plans: true` method and answers the `planId` the register minted
  for it; the commit calls the action's `commits` method with exactly `{ planId }` and the host-signed action grant that
  `register` verifies, each phase in its own fence, so an app's write works against every plugin built on `register`.
- **Minted plan ids:** the register mints every `planId` from 128 random bits, keeps the plan handler's full answer for
  the commit's `call.plan`, and never reuses a live id; a handler that answers its own `planId` is `PLAN_INVALID`.
- **One error table** (contract §12): `ERROR_CODES`, `SourceError` and `parseSourceError`. There are no aliases;
  `AUTH_REQUIRED` is not a contract code.
- **Hints, without routines** (decision D10): a plugin may ship a hint file per source for any model-based consumer;
  routines belong to the consumer.
- **The conformance kit** (`runConformance`, `t0`, `t1`): T0 (namespace and skill budgets, tool references, pin
  evidence, generated docs), T1 (the plugin loads on 2.4.1, its doors and permissions hold, LD-5's RPC refusal, a clean
  `HOST_UNTESTED` for an unsupported host), the declaration and its classes, two-account recordings, events, status,
  actions, and the #40 grant cases including the four refusals.
- **The examples** under `examples/`, each an installed package with a manifest, server entry, skills, generated docs
  and a recorded fixture, read as an app finds it on disk and run through the kit.
