/** The integration or MCP server name of `alias`: `<plugin>` for `default`, `<plugin>-<alias>` otherwise. */
export declare function accountName(plugin: string, alias: string): string;
/** The label a person sees next to a name: the plugin's title, and the alias when it has one. */
export declare function accountLabel(title: string, alias: string): string;
