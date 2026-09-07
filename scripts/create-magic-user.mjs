import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

async function run() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) {
    console.error("No .env.local found");
    return;
  }
  const env = fs.readFileSync(envPath, 'utf-8');
  
  // Try to find the service role key from supabase/.env.local or fallback
  const sbEnvPath = path.join(process.cwd(), 'supabase', '.env.local');
  let serviceRoleKey = '';
  if (fs.existsSync(sbEnvPath)) {
    const sbEnv = fs.readFileSync(sbEnvPath, 'utf-8');
    const match = sbEnv.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/);
    if (match) serviceRoleKey = match[1].trim();
  }
  
  const urlMatch = env.match(/VITE_SUPABASE_URL=(.*)/);
  if (!urlMatch || !serviceRoleKey) {
    console.error("Missing SUPABASE_URL or SERVICE_ROLE_KEY. Ensure you ran supabase start and have supabase/.env.local");
    return;
  }
  
  const supabase = createClient(urlMatch[1].trim(), serviceRoleKey);
  
  const email = process.env.VITE_MAGIC_LOGIN_EMAIL || 'dev@local.com';
  const password = process.env.VITE_MAGIC_LOGIN_PASSWORD || 'password123';
  
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {}
  });
  
  if (error) {
    if (error.message.includes("already registered")) {
       console.log("Magic user already exists in auth.");
       // Try fetching the user id to insert employee if missing
    } else {
       console.error("Auth Error:", error.message);
       return;
    }
  } else {
    console.log("Auth user created:", data.user.id);
    const { error: empErr } = await supabase.from('employees').insert({
      id: data.user.id,
      email: email,
      name: 'Local Solo Dev',
      department: 'Engineering',
      role: 'Super Admin',
      is_super_admin: true,
      is_deleted: false
    });
    
    if (empErr) {
      console.error("Employee Error:", empErr.message);
    } else {
      console.log("Employee record created successfully.");
    }
  }
}

run();
