-- Unsend a chat message: the sender can remove their own message within 15 minutes.
-- The row stays (sender + time kept); text, attachments, mentions and reactions are wiped,
-- and replies that quoted it lose the quoted text too.
CREATE OR REPLACE FUNCTION public.unsend_chat_message(p_table text, p_message_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
    v_author uuid;
    v_created timestamptz;
    v_removed jsonb;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Not signed in';
    END IF;

    IF p_table = 'task_activity' THEN
        SELECT author_id, created_at INTO v_author, v_created
        FROM public.task_activity WHERE id = p_message_id AND type = 'COMMENT';
    ELSIF p_table = 'committee_task_activity' THEN
        SELECT author_id, created_at INTO v_author, v_created
        FROM public.committee_task_activity WHERE id = p_message_id AND type = 'COMMENT';
    ELSE
        RAISE EXCEPTION 'Invalid table %', p_table;
    END IF;

    IF v_created IS NULL THEN
        RAISE EXCEPTION 'Message not found';
    END IF;
    IF v_author IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'You can only unsend your own messages';
    END IF;
    IF now() - v_created > interval '15 minutes' THEN
        RAISE EXCEPTION 'Messages can only be unsent within 15 minutes';
    END IF;

    v_removed := jsonb_build_object('removed', true, 'removedAt', now());

    IF p_table = 'task_activity' THEN
        UPDATE public.task_activity
        SET content = 'Message removed', metadata = v_removed
        WHERE id = p_message_id;

        UPDATE public.task_activity
        SET metadata = jsonb_set(metadata, '{replyTo}',
            (metadata->'replyTo') || '{"content":"Message removed","removed":true}'::jsonb)
        WHERE metadata->'replyTo'->>'id' = p_message_id::text;
    ELSE
        UPDATE public.committee_task_activity
        SET content = 'Message removed', metadata = v_removed
        WHERE id = p_message_id;

        UPDATE public.committee_task_activity
        SET metadata = jsonb_set(metadata, '{replyTo}',
            (metadata->'replyTo') || '{"content":"Message removed","removed":true}'::jsonb)
        WHERE metadata->'replyTo'->>'id' = p_message_id::text;
    END IF;

    RETURN v_removed;
END;
$function$;

REVOKE ALL ON FUNCTION public.unsend_chat_message(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unsend_chat_message(text, uuid) TO authenticated;
