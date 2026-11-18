import type { Validator } from "../checked.js";
/** Every core fact type's schema, by the type name a descriptor declares. */
export declare const FACT_SCHEMAS: {
    commitment: Validator<{
        type: "commitment";
        key: string;
        title: string;
        owner: string;
        state: "open" | "done" | "cancelled";
        counterparty?: string | undefined;
        due?: string | undefined;
        url?: string | undefined;
    }>;
    "person.attribute": Validator<{
        type: "person.attribute";
        actor: string;
        org?: string | undefined;
        team?: string | undefined;
        role?: string | undefined;
    }>;
    "meeting.attended": Validator<{
        type: "meeting.attended";
        actor: string;
        response: "accepted" | "declined" | "tentative" | "needs_action";
        organizer: boolean;
    }>;
};
/** The schema of a core fact type, or undefined for a type v0.3 does not have. */
export declare function factSchema(type: string): Validator<unknown> | undefined;
