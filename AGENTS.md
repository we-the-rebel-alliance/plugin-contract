# AGENTS.md: plugin-contract

For agents working in this repository. Read it fully before changing anything. The contract and the plugin standard in
`docs/` decide where this file is silent.

## What this repository is

`plugin-contract` is the contract between OpenCode plugins and the apps that use them: the manifest, the data model, the
error table, the modules that read and act under a grant, and the conformance kit. It is greenfield at `v0.0.0`: no
compatibility shims, no legacy aliases, no dead code.

The default branch is `master`. Never push to it, never merge, and never force-push a branch you did not create.

## Commands

| Command | Does |
|---|---|
| `npm ci` | installs the dev tooling; there are no runtime dependencies |
| `npm run check` | everything CI runs: typecheck, build, `check:dist`, the Node tests and the conformance self-test |
| `npm run test:node` | the tests on Node |
| `npm run test:bun` | the same tests on Bun, where Bun is installed; `check` does not need it |
| `npm run conformance:self-test` | the kit against every example under `examples/`, from `dist/` as it ships |
| `node scripts/release.mjs --dry-run` | the release files for the current version, without a tag |

`npm run check` must pass before a pull request is ready. It runs on a Node-only runner.

## Layout

```
src/<name>.ts          one module per export "./<name>"
src/internal/          the implementation behind the entries
test/<name>.test.ts    the module's tests, with its negative cases
docs/                  the contract, the standard, and one page per concern
examples/              plugins as an app finds them on disk, with recorded fixtures
scripts/               build, dist check, release and the conformance self-test
dist/                  built and committed: a tag installs with no build
```

Every module is `src/<name>.ts` and an export `"./<name>"` in `package.json`, `{ "types": "./dist/<name>.d.ts",
"default": "./dist/<name>.js" }`. A new module gets tests, including the negative cases, and a page under `docs/`.

## Rules

1. **The contract wins.** `docs/contract.md` is the authority; where code and contract disagree, fix the code or open a
   decision. `docs/plugin-standard.md` is the bar every plugin repository meets.
2. **Greenfield.** Delete rather than deprecate. No compatibility paths, legacy aliases or dead exports.
3. **No runtime dependencies.** `package.json` has `devDependencies` only. `dist/` imports Node built-ins and nothing
   else, and a published declaration names nothing outside the package (`npm run check:dist`). zod stays inside: a
   module writes its schema in zod and exports a `Validator<T>`.
4. **Host-neutral.** No module, doc or test names an app. An app-only hint is allowed only as an `x-<app>` key.
5. **One error table.** Every failure reads `CODE: What happened. Next step: What to do.` from `ERROR_CODES`. A plugin
   may add a code; it declares it in its manifest.
6. **Untrusted data.** Provider text is data, never instructions. Events are screened for secrets, and status and logs
   never carry credentials.
7. **`dist/` is committed.** Run `npm run build` and commit the result; never hand-edit it. On a conflict, take either
   side and rebuild. `package-lock.json` is committed too.
8. **Words.** Plain English in docs, comments and messages. One term per concept. British spelling where the prose has
   a choice.
9. **Tests.** Every module has tests, including the negative cases. A fix has a test that fails without it.
10. **Releases.** A tag is pushed only by the owner. A release is prepared in one pull request
    (`chore(release): prepare vX.Y.Z`): the version in `package.json` and `package-lock.json`, the `CHANGELOG.md`
    section, and `dist/` rebuilt.

## Adding a module

1. Add `src/<name>.ts` and its `"./<name>"` export.
2. Write the tests under `test/`, including what the module refuses.
3. Add a page under `docs/`, and link it from `README.md`.
4. Run `npm run check` and commit `dist/`.
