// Issues or reissues a password-login credential for an employee. This is the
// one place in the app that is allowed to touch auth.users directly, because
// that requires the service role key, which never leaves the server.
//
// Two actions, two different authorisation rules:
//
//   - "issue"   — the employee has no auth account yet (a brand-new hire, or
//                 one who has only ever used Google). Anyone who can create
//                 an employee at all (HR or Super Admin, mirroring the
//                 employees_write RLS policy) can issue their first password.
//   - "reissue" — the employee already has an account. Restricted to a
//                 Super Admin, and refused once the employee has set their
//                 own password (public.employees.is_issued_password is
//                 false) — those go through email verification instead.
//
// Both actions generate a fresh, per-employee random password, return it
// once in the response body, and never store or log it in readable form.
//
// Deploy with the default JWT verification ON — the caller's own token is
// what authorises the action; a request with no valid session is refused
// before it reaches any of this.
//
// This function can't import from src/ (it's a separately-deployed Deno
// runtime), so the two authorisation rules and the password generator below
// are re-stated inline. src/services/passwordPolicy.js is their JS twin,
// proven at Seam D — keep both in sync if either rule changes.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** A random, per-employee password. Never derived from anything guessable. */
function generatePassword() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "9")
    .replace(/\//g, "8")
    .replace(/=/g, "")
    + "!Aa1";
}

/**
 * The Admin API has no "get user by email" call, only a paginated listing —
 * so this walks every page rather than trusting the default page to hold
 * every employee, which would silently misfire once the user base grows
 * past it.
 */
async function findAuthUserByEmail(admin: ReturnType<typeof createClient>, email: string) {
  const target = email.toLowerCase();
  const perPage = 1000;
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const match = data.users.find((u) => (u.email || "").toLowerCase() === target);
    if (match) return match;
    if (data.users.length < perPage) return null;
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get("Authorization") || "";

  let employeeId: unknown;
  let action: unknown;
  try {
    ({ employeeId, action } = await req.json());
  } catch {
    return jsonResponse({ success: false, message: "Invalid request body." }, 400);
  }

  if (typeof employeeId !== "string" || !employeeId) {
    return jsonResponse({ success: false, message: "employeeId is required." }, 400);
  }
  if (action !== "issue" && action !== "reissue") {
    return jsonResponse({ success: false, message: 'action must be "issue" or "reissue".' }, 400);
  }

  // Caller identity, resolved through their own JWT so RLS/security-definer
  // functions answer for them, not for the service role.
  const callerClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const [{ data: isSuperAdmin }, { data: isHr }] = await Promise.all([
    callerClient.rpc("is_super_admin"),
    callerClient.rpc("is_hr"),
  ]);

  if (action === "reissue" && !isSuperAdmin) {
    return jsonResponse(
      { success: false, message: "Only a Super Admin can reissue a password." },
      403,
    );
  }
  if (action === "issue" && !isSuperAdmin && !isHr) {
    return jsonResponse(
      { success: false, message: "Only HR or a Super Admin can issue a password." },
      403,
    );
  }

  // Everything past this point runs with the service role, because creating
  // or updating an auth user requires the Admin API.
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: employee, error: employeeError } = await admin
    .from("employees")
    .select("id, email, is_issued_password")
    .eq("id", employeeId)
    .single();

  if (employeeError || !employee?.email) {
    return jsonResponse({ success: false, message: "Employee not found." }, 404);
  }

  const password = generatePassword();

  let existingUser;
  try {
    existingUser = await findAuthUserByEmail(admin, employee.email);
  } catch (lookupError) {
    return jsonResponse(
      { success: false, message: lookupError instanceof Error ? lookupError.message : "Lookup failed." },
      500,
    );
  }

  if (action === "issue") {
    if (existingUser) {
      return jsonResponse(
        { success: false, message: "This employee already has a sign-in account." },
        409,
      );
    }

    const { error: createError } = await admin.auth.admin.createUser({
      email: employee.email,
      password,
      email_confirm: true,
    });
    if (createError) {
      return jsonResponse({ success: false, message: createError.message }, 500);
    }
  } else {
    if (!existingUser) {
      return jsonResponse(
        { success: false, message: "This employee has no sign-in account to reissue." },
        404,
      );
    }
    if (!employee.is_issued_password) {
      return jsonResponse(
        {
          success: false,
          message:
            "This employee has already set their own password. Direct them to email verification instead.",
        },
        403,
      );
    }

    const { error: updateError } = await admin.auth.admin.updateUserById(existingUser.id, {
      password,
    });
    if (updateError) {
      return jsonResponse({ success: false, message: updateError.message }, 500);
    }
  }

  const { error: flagError } = await admin
    .from("employees")
    .update({ is_issued_password: true })
    .eq("id", employeeId);
  if (flagError) {
    return jsonResponse({ success: false, message: flagError.message }, 500);
  }

  return jsonResponse({ success: true, password, action });
});
