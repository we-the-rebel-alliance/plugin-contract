import type { Checked, Validator } from "../internal/checked.js";
import { canonicalJson, manifestHash } from "./canonical.js";
import { type ActionItem, type InstalledManifest, type Manifest, type MethodItem, type SourceItem } from "./types.js";
/** The `capabilities` value checked; problems name their path, such as `capabilities.methods.send.class`. */
export declare function checkManifest(value: unknown): Checked<Manifest>;
/** The manifest's problems, one sentence each; empty when it validates. */
export declare function manifestProblems(value: unknown): readonly string[];
/** The validator a module publishes: zod stays inside the package, and the JSON Schema is generated from it. */
export declare const MANIFEST_SCHEMA: Validator<Manifest>;
/**
 * The manifest of the package installed at `directory`: its package.json's `capabilities`, checked and hashed. With
 * `version`, the package.json must say that version, so a consumer reads the package it believes is installed.
 */
export declare function readInstalledManifest(directory: string, options?: {
    readonly version?: string;
}): Checked<InstalledManifest>;
/**
 * The directory of the package `name` as Node would find it installed from `from`: the nearest
 * `node_modules/<name>/package.json` at or above it. Undefined when none is installed.
 */
export declare function findInstalledPackage(name: string, from: string): string | undefined;
/** A source by id, from a manifest. */
export declare function findSource(manifest: Manifest, id: string): SourceItem | undefined;
/** An action by id, from a manifest. */
export declare function findAction(manifest: Manifest, id: string): ActionItem | undefined;
/** A method by name, from a manifest. */
export declare function findMethod(manifest: Manifest, name: string): MethodItem | undefined;
/** Whether a method takes an account: `optional` or `none`, `none` when it does not say. */
export declare function methodAccounts(method: Pick<MethodItem, "accounts">): "optional" | "none";
/** The most bytes one answer of this source may take: its `maxBytes`, or 64 KB. */
export declare function maxBytesOf(source: {
    readonly maxBytes?: number | undefined;
}): number;
export { canonicalJson, manifestHash };
