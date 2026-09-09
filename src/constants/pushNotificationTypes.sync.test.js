import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { PUSH_NOTIFICATION_TYPES } from "./pushNotificationTypes";

/**
 * supabase/functions/send-push/index.ts cannot import from src/ — it's a
 * separately-deployed Deno runtime — so it re-states this same set inline.
 * A type added to one list and not the other fails silently (a push-eligible
 * type the function refuses, or a refused type nothing ever sends), so this
 * test parses the function's own allowlist out of its source and asserts the
 * two sets are identical, rather than trusting the comment asking someone to
 * keep them in sync by hand.
 */
describe("the send-push edge function's inline type allowlist", () => {
  it("matches PUSH_NOTIFICATION_TYPES exactly", () => {
    const functionPath = path.resolve(process.cwd(), "supabase/functions/send-push/index.ts");
    const source = readFileSync(functionPath, "utf8");

    const match = source.match(/const PUSH_NOTIFICATION_TYPES = new Set\(\[([\s\S]*?)\]\);/);
    expect(match, "could not find the PUSH_NOTIFICATION_TYPES literal in send-push/index.ts").toBeTruthy();

    const edgeFunctionTypes = [...match[1].matchAll(/"([A-Z_]+)"/g)].map((m) => m[1]);

    expect(new Set(edgeFunctionTypes)).toEqual(PUSH_NOTIFICATION_TYPES);
  });
});
