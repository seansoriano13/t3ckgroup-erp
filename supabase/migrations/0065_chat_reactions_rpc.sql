CREATE OR REPLACE FUNCTION toggle_chat_reaction(
    p_table text,
    p_message_id uuid,
    p_user_id uuid,
    p_emoji text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_metadata jsonb;
    v_reactions jsonb;
    v_users jsonb;
    v_user_idx int;
BEGIN
    IF p_table = 'task_activity' THEN
        SELECT COALESCE(metadata, '{}'::jsonb) INTO v_metadata
        FROM public.task_activity WHERE id = p_message_id;
    ELSIF p_table = 'committee_task_activity' THEN
        SELECT COALESCE(metadata, '{}'::jsonb) INTO v_metadata
        FROM public.committee_task_activity WHERE id = p_message_id;
    ELSE
        RAISE EXCEPTION 'Invalid table %', p_table;
    END IF;

    IF v_metadata IS NULL THEN
        RAISE EXCEPTION 'Message not found';
    END IF;

    v_reactions := COALESCE(v_metadata->'reactions', '{}'::jsonb);
    v_users := COALESCE(v_reactions->p_emoji, '[]'::jsonb);

    -- Find if user is in the array
    SELECT position - 1 INTO v_user_idx
    FROM jsonb_array_elements_text(v_users) WITH ORDINALITY arr(elem, position)
    WHERE elem = p_user_id::text;

    IF v_user_idx IS NOT NULL THEN
        -- Remove user
        v_users := v_users - v_user_idx;
        IF jsonb_array_length(v_users) = 0 THEN
            v_reactions := v_reactions - p_emoji;
        ELSE
            v_reactions := jsonb_set(v_reactions, ARRAY[p_emoji], v_users);
        END IF;
    ELSE
        -- Add user
        v_users := v_users || to_jsonb(p_user_id::text);
        v_reactions := jsonb_set(v_reactions, ARRAY[p_emoji], v_users);
    END IF;

    -- If reactions is empty, we can just remove the key, or leave it empty {}
    IF v_reactions = '{}'::jsonb THEN
        v_metadata := v_metadata - 'reactions';
    ELSE
        v_metadata := jsonb_set(v_metadata, ARRAY['reactions'], v_reactions);
    END IF;

    IF p_table = 'task_activity' THEN
        UPDATE public.task_activity SET metadata = v_metadata WHERE id = p_message_id;
    ELSIF p_table = 'committee_task_activity' THEN
        UPDATE public.committee_task_activity SET metadata = v_metadata WHERE id = p_message_id;
    END IF;

    RETURN v_metadata;
END;
$$;
