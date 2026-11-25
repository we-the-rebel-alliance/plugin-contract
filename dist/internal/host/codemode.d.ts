/**
 * OpenCode 2.4 behaviour 5: a nested Code Mode call carries its own call id and `codemode: true`.
 *
 * The outer call's id is the tool call's id; every tool a Code Mode script calls from inside gets a fresh one, so a log
 * or a permission ask can be traced to the inner call and its input. The harness hands out contexts in the shape
 * `Tool.Context` has in 2.4.1 (`id`, `sessionID`, `agent`, `messageID`, `codemode`), with strings where the host brands
 * them.
 */
/** The fields of a tool call the harness reads, matching `Tool.Context` in 2.4.1. */
export interface ToolCallLike {
    readonly id: string;
    readonly sessionID: string;
    readonly agent: string;
    readonly messageID: string;
    readonly codemode?: boolean | undefined;
}
/** The session a tool call runs in. */
export interface CodeModeSession {
    readonly sessionID: string;
    readonly agent: string;
    readonly messageID: string;
}
/** One call to one tool, as the harness logs it. */
export interface ToolCall extends ToolCallLike {
    readonly tool: string;
    readonly input: unknown;
}
/** What a caller gives one tool call. The id is optional; the harness makes one when it is absent. */
export interface ToolCallInput {
    readonly tool: string;
    readonly input?: unknown;
    readonly id?: string | undefined;
}
/** The Code Mode harness for one session. */
export interface CodeModeHarness {
    /** A tool call from the agent: `codemode: false`. */
    topLevel(call: ToolCallInput): ToolCall;
    /** A tool call from inside `execute`: a fresh id and `codemode: true`. */
    nested(call: ToolCallInput): ToolCall;
    readonly calls: readonly ToolCall[];
}
/** Create the harness for one session. Every id is unique within the session. */
export declare function createCodeMode(session: CodeModeSession, options?: {
    readonly nextID?: (() => string) | undefined;
}): CodeModeHarness;
