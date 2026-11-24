# Contributing

`plugin-contract` is the language between OpenCode plugins and the apps that use them. The contract is
[docs/contract.md](docs/contract.md), the bar for every plugin repository is [docs/plugin-standard.md](docs/plugin-standard.md),
and [AGENTS.md](AGENTS.md) is the working guide.

## Set up and check

You need Node 22.18 or later. Bun is optional; it runs the same tests locally.

```sh
npm ci --ignore-scripts
npm run check
```

`npm run check` runs the core gates:

| Step | What it proves |
|---|---|
| `npm run typecheck` | the sources and tests typecheck under strict settings |
| `npm run build` | `dist/` is built: one bundled ES module per export, its declarations, the JSON Schemas and the notices of what is bundled |
| `npm run check:dist` | `dist/` imports only Node built-ins, its declarations name nothing outside the package, and every export loads from a bare copy on Node (and on Bun when it is installed) |
| `npm test` | the tests pass on Node (`node --test`) |
| `npm run conformance:self-test` | the conformance kit accepts every example under `examples/`, from `dist/` as it ships |

CI runs these steps in one job named `ci`, and four more: actionlint, `npm run test:bun`, `git diff --exit-code -- dist`
(the committed `dist/` must be what a fresh build makes), `node scripts/release.mjs --dry-run`, and the Node 22 tests.

## The rules

- **No runtime dependencies.** Anything the package uses is bundled into `dist/` (zod included); at run time it needs
  only Node built-ins. `package.json` has `devDependencies` only.
- **zod stays inside.** Export a `Validator<T>` (`src/internal/validator.ts`), never the zod schema. Add the validator
  to `SCHEMAS` in `src/schemas.ts`, and the build writes its JSON Schema to `dist/schemas/`.
- **One entry per module.** `src/<name>.ts` and `"./<name>"` in `package.json`. Internal code lives in `src/internal/`.
- **`dist/` is committed.** A consumer pins a tag, and the install runs no build. Run `npm run build` and commit
  `dist/` with your change; CI fails when it differs from what the build makes.
- **Host-neutral.** No module or doc names an app, except in an `x-<app>` key.
- **Plain English.** Short sentences, one term per concept. An error message reads
  `CODE: what happened. Next step: …`.

## Pull requests

One change per pull request, based on `master`, with a conventional commit (`feat:`, `fix:`, `docs:`, `chore:`). Fill
in what changed and why, the contract section it implements, and the exact `npm run check` result. A new module comes
with tests, including the negative cases, and a page under `docs/`.

## Releases

Releases are tagged GitHub releases, not npm. A tag `v<package.json version>` on a `master` commit whose CI passed runs
[the release workflow](.github/workflows/release.yml), which attaches the packed package, the conformance kit as one
file, the schema bundle and `SHA256SUMS`. Only the owner decides a release; an agent never pushes a tag on its own.

A release is prepared in one pull request, `chore(release): prepare vX.Y.Z`: the version in `package.json` and
`package-lock.json` (`npm version X.Y.Z --no-git-tag-version`), the `CHANGELOG.md` section, and `dist/` rebuilt by
`npm run build`. The tag goes on the merged commit once `master`'s CI has passed.
