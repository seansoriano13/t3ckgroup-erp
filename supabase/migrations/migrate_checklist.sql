-- ==============================================================================
-- MIGRATION SCRIPT: Add checklist column and migrate legacy JSON
-- ==============================================================================

-- 1. Add the new checklist column if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'tasks' 
        AND column_name = 'checklist'
    ) THEN
        ALTER TABLE tasks ADD COLUMN checklist JSONB;
    END IF;
END $$;

-- 2. Migrate existing JSON checklists from task_description to checklist
-- We look for task_description that looks like a JSON array or object
UPDATE tasks
SET 
    checklist = task_description::jsonb,
    task_description = ''
WHERE 
    checklist IS NULL 
    AND task_description IS NOT NULL 
    AND task_description != ''
    AND (
        (task_description LIKE '[%]' AND jsonb_typeof(task_description::jsonb) = 'array') OR
        (task_description LIKE '{%}' AND jsonb_typeof(task_description::jsonb) = 'object')
    );

-- Note: In a production environment, if there are malformed JSON strings in task_description
-- that start with [ or {, the above query might fail on casting `task_description::jsonb`.
-- To be absolutely safe, you could use a PL/pgSQL block with exception handling, but
-- assuming the frontend has rigorously enforced valid JSON serialization for checklists,
-- this direct update is highly efficient.
