import type { ConformanceRunner, Git } from "./types.js";
/** The commands, for help and for a typo's next step. */
export declare const COMMANDS: readonly ["check", "docs", "record", "conformance", "hosts", "release", "supported", "forbidden"];
export type Command = (typeof COMMANDS)[number];
/** What a test may replace; everything else comes from the process. */
export interface MainOptions {
    readonly cwd?: string | undefined;
    readonly stdout?: ((text: string) => void) | undefined;
    readonly stderr?: ((text: string) => void) | undefined;
    readonly conformance?: (() => Promise<ConformanceRunner>) | undefined;
    readonly git?: Git | undefined;
    readonly now?: (() => Date) | undefined;
}
/** The help text, also what a missing command prints. */
export declare const HELP = "plugin-kit: the plugin contract's development kit\n\nUsage: plugin-kit <command> [options]\n\nCommands:\n  check                     T0, T1 on every tested host, generated docs, forbidden patterns\n  docs                      write the manifest-driven doc sections\n  record                    record provider fixtures, then redact secrets and personal data\n  conformance               run the whole conformance report\n  hosts                     print the OpenCode release matrix\n  release <version>         checks, changelog section, version, one commit and one tag\n  supported                 print this plugin's SUPPORTED.md row\n  forbidden                 check app names, main-branch links and secrets\n\nOptions:\n  --dir <path>              the plugin directory (default: the working directory)\n  --json                    print one JSON object instead of a report\n  --help                    this text, or a command's options\n  --host <release>          a host for check or conformance (repeatable)\n  --check                   report drift only (docs, record)\n  --account <alias>         the account a recording belongs to\n  --fixtures <path>         the fixture file (default: fixtures/conformance.json)\n  --record                  record while running conformance\n  --dry-run                 write nothing (release)\n  --wave <name>             the SUPPORTED.md wave cell\n  --status <state>          the SUPPORTED.md status cell\n";
/** Run the command line and answer the process's exit code. */
export declare function main(argv: readonly string[], options?: MainOptions): Promise<number>;
