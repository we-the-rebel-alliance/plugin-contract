// @we-the-rebel-alliance/plugin-contract 0.0.0. Built by scripts/build.mjs; do not edit.
import {
  readInstalledDescriptor
} from "./chunks/chunk-ZWKV37GW.js";
import "./chunks/chunk-6E62CHFC.js";
import "./chunks/chunk-RGWXXX65.js";
import "./chunks/chunk-T2QSLHBQ.js";
import "./chunks/chunk-2V4VLI45.js";
import "./chunks/chunk-65FTIXYZ.js";
import "./chunks/chunk-BQEBNVNU.js";
import "./chunks/chunk-577LF5CA.js";
import "./chunks/chunk-7KJXMIQH.js";
import "./chunks/chunk-WLRWVIVP.js";

// src/list.ts
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
var listed = (installed) => ({
  directory: installed.directory,
  package: installed.package,
  version: installed.version,
  sources: installed.sources,
  acts: installed.sources.acts ?? [],
  hash: installed.hash
});
function childPackages(root) {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch (error) {
    const code = error.code;
    throw Object.assign(new Error(code === "ENOTDIR" ? "not a directory" : "could not be read"), { code });
  }
  const found = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".") || !entry.isDirectory()) continue;
    const path = join(root, entry.name);
    if (!entry.name.startsWith("@")) {
      found.push(path);
      continue;
    }
    let scoped;
    try {
      scoped = readdirSync(path, { withFileTypes: true });
    } catch {
      found.push(path);
      continue;
    }
    for (const child of scoped) {
      if (child.name.startsWith(".") || !child.isDirectory()) continue;
      found.push(join(path, child.name));
    }
  }
  return found.sort();
}
function targets(input) {
  if (typeof input !== "string") {
    return { directories: [...input].sort(), problems: [] };
  }
  if (input.length === 0) return { directories: [], problems: [{ directory: input, problems: ["no directory to list"] }] };
  if (!existsSync(input)) return { directories: [], problems: [{ directory: input, problems: [`no directory at ${input}`] }] };
  if (existsSync(join(input, "package.json"))) return { directories: [input], problems: [] };
  try {
    const children = childPackages(input);
    if (children.length === 0) return { directories: [], problems: [{ directory: input, problems: [`no packages at ${input}`] }] };
    return { directories: children, problems: [] };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "could not be read";
    return { directories: [], problems: [{ directory: input, problems: [`${input} ${reason}`] }] };
  }
}
function listInstalledDeclarations(input) {
  const { directories, problems } = targets(input);
  const declarations = [];
  const found = [...problems];
  for (const directory of directories) {
    const installed = readInstalledDescriptor(directory);
    if (installed.ok) declarations.push(listed(installed.value));
    else found.push({ directory, problems: installed.problems });
  }
  return { declarations, problems: found };
}
export {
  listInstalledDeclarations
};
