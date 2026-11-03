// `pnpm local:start`: starts the local Supabase stack, then serves the edge
// functions with the Odoo login from supabase/functions/.env (gitignored), so
// nothing is started by hand. Stays running; Ctrl+C stops the function server.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const envFile = "supabase/functions/.env";
const run = (args) =>
  spawnSync("npx", ["supabase", ...args], { stdio: "inherit", shell: true });

if (run(["start"]).status !== 0) process.exit(1);

const serveArgs = ["supabase", "functions", "serve"];
if (existsSync(envFile)) {
  serveArgs.push("--env-file", envFile);
  console.log(
    `Serving edge functions with ${envFile}. Odoo writes stay refused unless ODOO_ALLOW_LOCAL_WRITES=true is set there.`,
  );
} else {
  console.warn(
    `${envFile} not found: serving edge functions without the Odoo login (sample data only).`,
  );
}
const child = spawn("npx", serveArgs, { stdio: "inherit", shell: true });
child.on("exit", (code) => process.exit(code ?? 0));
