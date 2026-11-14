import type { SourceItem } from "../schema/types.js";
/** The name a plugin knows a source by in `probe`'s input and answer: the descriptor's `input.source`, when it has one. */
export declare function probeSourceName(source: Pick<SourceItem, "input">): string | undefined;
/** Every problem with a probe answer, one sentence each; `expected.account` is the account the probe was asked about. */
export declare function probeProblems(answer: unknown, source: SourceItem, expected?: {
    readonly account?: string;
}): string[];
