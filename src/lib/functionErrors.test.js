import { describe, expect, it } from "vitest";
import { functionErrorMessage } from "./functionErrors";

const FALLBACK = "Couldn't check S01237 against Odoo. Try again.";

const httpError = (response) => ({ name: "FunctionsHttpError", message: "Edge Function returned a non-2xx status code", context: response });

describe("functionErrorMessage (#889)", () => {
  it("returns the function's own message from a non-2xx JSON body", async () => {
    const response = new Response(JSON.stringify({ message: "Odoo is paused for maintenance." }), { status: 503 });

    await expect(functionErrorMessage(httpError(response), FALLBACK)).resolves.toBe("Odoo is paused for maintenance.");
  });

  it("uses the fallback when a non-2xx body is not JSON", async () => {
    const response = new Response("Function not found", { status: 404 });

    await expect(functionErrorMessage(httpError(response), FALLBACK)).resolves.toBe(FALLBACK);
  });

  it("uses the fallback when a non-2xx JSON body has no message", async () => {
    const response = new Response(JSON.stringify({ error: "boom" }), { status: 500 });

    await expect(functionErrorMessage(httpError(response), FALLBACK)).resolves.toBe(FALLBACK);
  });

  it("uses the fallback when the message is blank", async () => {
    const response = new Response(JSON.stringify({ message: "   " }), { status: 500 });

    await expect(functionErrorMessage(httpError(response), FALLBACK)).resolves.toBe(FALLBACK);
  });

  it("uses the fallback for an unreachable function, never the raw transport text", async () => {
    const unreachable = { name: "FunctionsFetchError", message: "Failed to send a request to the Edge Function" };

    await expect(functionErrorMessage(unreachable, FALLBACK)).resolves.toBe(FALLBACK);
  });

  it("uses the fallback when there is no error object at all", async () => {
    await expect(functionErrorMessage(null, FALLBACK)).resolves.toBe(FALLBACK);
  });
});
