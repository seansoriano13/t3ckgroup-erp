// Who is calling an edge function that is deployed with JWT verification on:
// the signed-in employee's email, read from the session token the request
// carried. One way for every function that acts "as the caller" through a
// service-role-only database function, so they cannot drift apart.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

/** The signed-in caller's email, from the JWT the request carried; null if it is not a session. */
export async function callerEmail(req: Request): Promise<string | null> {
  const authorization = req.headers.get("Authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user?.email) return null;
  return data.user.email;
}
