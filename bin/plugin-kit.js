#!/usr/bin/env node
// plugin-kit: the plugin contract's development kit. The binary is this three-line shim; the commands are in
// dist/kit.js, built from src/kit.ts and committed with the package.
import { main } from "../dist/kit.js"

process.exitCode = await main(process.argv.slice(2))
