-- Remove stage conditions that reference columns that have been deleted from sales_opportunities
DELETE FROM stage_conditions
WHERE kind = 'field' 
AND config->>'column' IN (
    'so_number', 
    'quote_number', 
    'itb_number', 
    'jo_number', 
    'proposal_link', 
    'contact_no', 
    'itb_start', 
    'itb_end'
);
