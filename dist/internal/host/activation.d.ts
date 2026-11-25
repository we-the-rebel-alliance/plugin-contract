/** What activation needs: a predicate, a bound, and a clock and sleep a test can replace. */
export interface ActivationOptions {
    readonly isActive: () => boolean | Promise<boolean>;
    readonly timeoutMs?: number | undefined;
    readonly pollMs?: number | undefined;
    readonly now?: (() => number) | undefined;
    readonly sleep?: ((ms: number) => Promise<void>) | undefined;
}
/** Wait until the plugin is active, and refuse at the bound. */
export declare function waitForActivation(options: ActivationOptions): Promise<void>;
