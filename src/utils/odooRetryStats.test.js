import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Odoo's "try again" answers (HTTP 429) are counted, so the OPEX timing line can
// show how much of a slow read was spent waiting on them (#1266).
// odoo.ts reads its settings from Deno.env when it loads, so Deno is stubbed first.

let odoo;
let replies;

function stubOdoo() {
  vi.stubGlobal("Deno", { env: { get: (k) => ({ ODOO_URL: "https://odoo.test", ODOO_DB: "db" })[k] } });
  vi.stubGlobal("fetch", async () => replies.shift()());
}

const tooMany = () => new Response("<html>Rate limit exceeded</html>", { status: 429 });
const answer = (result) => () => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));

beforeAll(async () => {
  stubOdoo();
  odoo = await import("../../supabase/functions/_shared/odoo.ts");
});

// The test config undoes stubs before each test, so they are set again here.
beforeEach(() => stubOdoo());

describe("odooRetryStats", () => {
  it("counts each retry and the time spent waiting before it", async () => {
    const before = odoo.odooRetryStats();
    replies = [tooMany, answer([{ id: 1 }])];

    expect(await odoo.odooCall("object", "execute_kw", [])).toEqual([{ id: 1 }]);

    const after = odoo.odooRetryStats();
    expect(after.retries - before.retries).toBe(1);
    expect(after.waitMs - before.waitMs).toBe(500);
  });

  it("counts nothing when Odoo answers at once", async () => {
    const before = odoo.odooRetryStats();
    replies = [answer(7)];

    await odoo.odooCall("common", "version", []);

    expect(odoo.odooRetryStats()).toEqual(before);
  });
});
