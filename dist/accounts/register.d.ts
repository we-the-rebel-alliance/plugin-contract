import type { AccountMechanism, Manifest } from "../manifest/types.js";
import type { AccountProfile } from "./profiles.js";
/**
 * The editor inside `ctx.integration.transform`, as this module uses it. The host's own type is wider; the
 * compile-time proof below keeps this shape assignable to it.
 */
export interface IntegrationEditor {
    update(id: string, update: (integration: {
        id: string;
        name: string;
    }) => void): void;
    readonly method: {
        update(input: IntegrationMethodRegistration): void;
    };
}
/** One auth method registration, as `editor.method.update` takes it. The host validates the method's own shape. */
export interface IntegrationMethodRegistration {
    readonly integrationID: string;
    readonly [key: string]: unknown;
}
/** The editor inside `ctx.mcp.transform`, as this module uses it. */
export interface MCPEditor {
    set(name: string, config: MCPServerConfig): void;
}
/** One MCP server config, passed through to the host. */
export interface MCPServerConfig {
    readonly [key: string]: unknown;
}
/**
 * The part of a plugin context registration uses: the two transforms, and nothing else. The editor is `unknown` here,
 * because the host's types are wider than this module needs; `registerAccounts` narrows each one.
 */
export interface AccountsContext {
    readonly integration: {
        readonly transform: (callback: (editor: unknown) => void) => Promise<unknown>;
    };
    readonly mcp: {
        readonly transform: (callback: (editor: unknown) => void) => Promise<unknown>;
    };
}
/** What to register: the manifest, the plugin's options, and its own sign-in wiring. */
export interface RegisterAccountsRequest {
    readonly manifest: Manifest;
    /** The plugin's options, including `accounts`. */
    readonly options?: Readonly<Record<string, unknown>> | undefined;
    /** The auth methods for one integration, named by the id the account gets. */
    readonly auth?: ((account: AccountProfile, integrationID: string) => readonly IntegrationMethodRegistration[]) | undefined;
    /** The MCP server config for one alias, named by the server the account gets. */
    readonly server?: ((account: AccountProfile, name: string) => MCPServerConfig) | undefined;
}
/** One account as registered: its alias and the integration or server name it uses. */
export interface RegisteredAccount {
    readonly alias: string;
    readonly name: string;
}
/** What registration did, and what it could not. Never throws for a plugin's own wiring. */
export interface AccountsRegistration {
    readonly mechanism: AccountMechanism | undefined;
    readonly accounts: readonly RegisteredAccount[];
    readonly problems: readonly string[];
}
/**
 * Registers every account through `ctx.integration.transform` or `ctx.mcp.transform`. A local plugin registers
 * nothing: its one account is the machine's identity.
 */
export declare function registerAccounts(context: AccountsContext, request: RegisterAccountsRequest): Promise<AccountsRegistration>;
