import postgres from 'postgres';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// 1. Parse .env.local manually to get Postgres connection strings
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '../.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
    if (line && !line.startsWith('#')) {
        const parts = line.split('=');
        if (parts.length >= 2) {
            const key = parts.shift().trim();
            const value = parts.join('=').trim().replace(/^"|"$/g, '');
            env[key] = value;
        }
    }
});

const PROD_URL = env.PROD_DB_URL;
const STAGING_URL = env.STAGING_DB_URL;

if (!PROD_URL || !STAGING_URL || !PROD_URL.startsWith('postgresql') || !STAGING_URL.startsWith('postgresql')) {
    console.error("❌ CRITICAL: PROD_DB_URL and STAGING_DB_URL must be valid postgresql:// connection strings in .env.local");
    process.exit(1);
}

const prodSql = postgres(PROD_URL, { ssl: 'require' });
const stagingSql = postgres(STAGING_URL, { ssl: 'require' });

// We must insert in topological order to avoid FK errors
const TABLES = [
    'app_settings',
    'faq_data',
    'committee_roles',
    'crm_pipeline_stages',
    'crm_lead_sources',
    'commission_departments',
    'commission_positions',
    'commission_rates',
    'commission_splits',
    'employees',
    'categories',
    'group_task_templates',
    'group_task_template_members',
    'sales_quotas',
    'sales_weekly_plans',
    'system_updates',
    'chat_read_receipts',
    'sales_custom_templates',
    'chat_user_archives',
    'overtime_requests',
    'offset_leaves',
    'sil_leaves',
    'system_audit_logs',
    'sales_opportunities',
    'sales_opportunity_logs',
    'sales_opportunity_items',
    'sales_activities',
    'sales_activity_logs',
    'sales_revenue_logs',
    'revenue_activity_logs',
    'sales_quota_logs',
    'tasks',
    'task_activity',
    'committee_tasks',
    'committee_task_members',
    'committee_task_activity',
    'committee_task_logs',
    'notifications',
    'sor_procurement_requests'
];

async function sync() {
    console.log("🚀 Starting Data Sync from Prod to Staging...");
    
    // 1. Truncate staging in reverse order
    console.log("\n🧹 Clearing Staging database (TRUNCATE CASCADE)...");
    
    // Disable triggers and foreign keys for the session
    await stagingSql`SET session_replication_role = 'replica';`;

    for (let i = TABLES.length - 1; i >= 0; i--) {
        const table = TABLES[i];
        try {
            await stagingSql`TRUNCATE TABLE public.${stagingSql(table)} CASCADE`;
        } catch (e) {
            // Ignore truncation errors if tables don't exist
        }
    }

    // 2. Fetch and Insert
    console.log("\n📥 Fetching and Inserting tables...");
    for (const table of TABLES) {
        process.stdout.write(`- [${table}]... `);
        try {
            // A. Get columns from Staging and Prod to find the intersection
            const stagingCols = await stagingSql`
                SELECT column_name, is_identity
                FROM information_schema.columns 
                WHERE table_schema = 'public' AND table_name = ${table}
            `;
            const prodCols = await prodSql`
                SELECT column_name
                FROM information_schema.columns 
                WHERE table_schema = 'public' AND table_name = ${table}
            `;
            
            if (stagingCols.length === 0 || prodCols.length === 0) {
                console.log(`0 columns found or table missing. (Skipped)`);
                continue;
            }
            
            // Only select columns that exist in BOTH databases
            const prodColNames = new Set(prodCols.map(c => c.column_name));
            const commonColDefs = stagingCols.filter(c => prodColNames.has(c.column_name));
            const columns = commonColDefs.map(c => c.column_name);

            // B. Fetch only the intersected columns from Prod
            const rows = await prodSql`
                SELECT ${prodSql(columns)} 
                FROM public.${prodSql(table)}
            `;
            
            if (rows.length === 0) {
                console.log(`0 rows. (Skipped)`);
                continue;
            }

            // C. Sanitization step for specific tables
            if (table === 'sales_opportunities') {
                rows.forEach(r => {
                    if (r.client_email) r.client_email = `scrubbed_${r.id?.split('-')[0]}@example.com`;
                    if (r.client_phone) r.client_phone = '555-0000';
                    if (r.contact_number) r.contact_number = '555-0000';
                });
            }
            if (table === 'sales_activities') {
                rows.forEach(r => {
                    if (r.contact_email) r.contact_email = `scrubbed_${r.id?.split('-')[0]}@example.com`;
                    if (r.contact_number) r.contact_number = '555-0000';
                });
            }

            // D. Chunk inserts to avoid MAX_PARAMETERS_EXCEEDED (65535 limit)
            const hasIdentity = commonColDefs.some(c => c.is_identity === 'YES');
            const CHUNK_SIZE = 1000;
            let totalInserted = 0;
            for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
                const chunk = rows.slice(i, i + CHUNK_SIZE);
                
                // Format the values block
                const values = chunk.map(r => columns.map(c => r[c]));

                if (hasIdentity) {
                    await stagingSql`
                        INSERT INTO public.${stagingSql(table)} 
                        (${stagingSql(columns)}) 
                        OVERRIDING SYSTEM VALUE 
                        VALUES ${stagingSql(values)}
                    `;
                } else {
                    await stagingSql`
                        INSERT INTO public.${stagingSql(table)} 
                        (${stagingSql(columns)}) 
                        VALUES ${stagingSql(values)}
                    `;
                }
                totalInserted += chunk.length;
            }

            console.log(`✅ Inserted ${totalInserted} rows.`);
        } catch (err) {
            console.log(`❌ Error: ${err.message}`);
        }
    }

    console.log("\n✅ Sync Complete!");
    await prodSql.end();
    await stagingSql.end();
}

sync().catch(err => {
    console.error(err);
    process.exit(1);
});
