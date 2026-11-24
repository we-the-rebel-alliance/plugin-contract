// @we-the-rebel-alliance/plugin-contract 0.0.0. Built by scripts/build.mjs; do not edit.
import {
  readInstalledManifest
} from "./chunks/chunk-GENAPX63.js";
import "./chunks/chunk-34YMSPZQ.js";
import "./chunks/chunk-S3ZVQTGH.js";
import "./chunks/chunk-3GQYQSG2.js";
import "./chunks/chunk-OGAJDQ7Z.js";
import "./chunks/chunk-L3NVT2DE.js";
import "./chunks/chunk-7KJXMIQH.js";
import "./chunks/chunk-WLRWVIVP.js";

// src/list.ts
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
var listed = (installed) => ({
  directory: installed.directory,
  package: installed.package,
  version: installed.version,
  manifest: installed.manifest,
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
    const installed = readInstalledManifest(directory);
    if (installed.ok) declarations.push(listed(installed.value));
    else found.push({ directory, problems: installed.problems });
  }
  return { declarations, problems: found };
}
export {
  listInstalledDeclarations
};
