import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';

// Fix .env temporarily in memory for dotenv
let envContent = fs.readFileSync('.env', 'utf8');
envContent = envContent.replace('VITE_GITHUB_REPO\n', 'VITE_GITHUB_REPO=\n');

const buf = Buffer.from(envContent);
const envConfig = dotenv.parse(buf);

const supabaseUrl = envConfig.VITE_SUPABASE_URL;
const supabaseKey = envConfig.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log("Checking if crm_lead_sources table exists...");
  
  const { data: fetchCheck, error: fetchError } = await supabase
    .from("crm_lead_sources")
    .select("*")
    .limit(1);
    
  if (fetchError) {
    console.error("Error querying crm_lead_sources. Table might not exist:", fetchError.message);
    process.exit(1);
  }
  
  console.log("Table exists! Seed count:", fetchCheck.length);
  
  const seedData = [
    { value: 'LGU', label: 'LGU' },
    { value: 'NGA', label: 'NGA' },
    { value: 'GOCC', label: 'GOCC' },
    { value: 'BFP', label: 'BFP' },
    { value: 'PNP', label: 'PNP' },
    { value: 'MIL', label: 'MIL' },
    { value: 'DRRM', label: 'DRRM' },
    { value: 'CORPORATE', label: 'Corporate' },
    { value: 'REFERRAL', label: 'Referral' },
    { value: 'WEBSITE', label: 'Website' },
    { value: 'FACEBOOK', label: 'Facebook' },
    { value: 'TIKTOK', label: 'TikTok' },
    { value: 'SHOPEE', label: 'Shopee' },
    { value: 'LAZADA', label: 'Lazada' },
    { value: 'EXHIBITION', label: 'Exhibition' },
    { value: 'REPEAT_CLIENT', label: 'Repeat Client' },
  ];

  const { data, error } = await supabase
    .from("crm_lead_sources")
    .insert(seedData)
    .select();
    
  if (error) {
    console.error("Failed to insert data:", error.message);
  } else {
    console.log("Successfully inserted", data.length, "lead sources.");
  }
}

main();
