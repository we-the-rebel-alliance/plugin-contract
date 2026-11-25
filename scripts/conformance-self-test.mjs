// The conformance kit run on the package's own examples, from dist/ as it ships.
//
//   node scripts/conformance-self-test.mjs
//
// Each directory under examples/ is an installed plugin as a consumer finds it on disk: a package.json with a
// top-level `capabilities` key and a server entry, skills and generated docs, and a fixtures/conformance.json that
// records what the plugin answers. The manifest is read and hashed as a consumer reads it, then `runConformance` runs
// T0, the declaration, the recordings and T1 on the tested host and on an unsupported one.
import { existsSync, readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const examples = join(root, "examples")
const manifest = await import(pathToFileURL(join(root, "dist", "manifest.js")).href)
const conformance = await import(pathToFileURL(join(root, "dist", "conformance.js")).href)

const problems = []
let count = 0
let findings = 0
for (const name of existsSync(examples) ? readdirSync(examples).sort() : []) {
  const directory = join(examples, name)
  if (!existsSync(join(directory, "package.json"))) continue
  count++
  const installed = manifest.readInstalledManifest(directory)
  if (!installed.ok) {
    problems.push(...installed.problems.map((problem) => `examples/${name}: ${problem}`))
    continue
  }
  const report = await conformance.runConformance(directory)
  findings += report.findings.length
  problems.push(...report.findings.map((finding) => `examples/${name}: ${finding.level} ${finding.id}: ${finding.message}`))
  const methods = Object.keys(installed.value.manifest.methods).length
  const sources = installed.value.manifest.sources.map((source) => source.id).join(", ") || "no sources"
  console.log(`examples/${name}: ${methods} methods, ${sources} (${installed.value.hash})`)
}
if (count === 0) {
  console.error("the conformance self-test found no examples: add one under examples/")
  process.exit(1)
}
if (problems.length > 0) {
  console.error(`the conformance self-test failed:\n- ${problems.join("\n- ")}`)
  process.exit(1)
}
console.log(`conformance self-test: ${count} examples, ${findings} findings, every example accepted`)
