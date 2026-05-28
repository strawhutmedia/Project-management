-- Rename in-place: items with kind='story_text' become kind='story_concept'
-- with medium='photo' (the legacy story_text was a still-overlay caption,
-- so photo is the safe default) and the existing text moves to caption.
-- Empty fields are seeded so the new schema's required fields are present.
UPDATE social_plans
SET items = COALESCE((
  SELECT jsonb_agg(
    CASE
      WHEN item->>'kind' = 'story_text' THEN
        jsonb_build_object(
          'id', item->>'id',
          'kind', 'story_concept',
          'status', COALESCE(item->>'status', 'idea'),
          'assignee_user_id', item->'assignee_user_id',
          'medium', 'photo',
          'description', COALESCE(item->>'text', ''),
          'caption', COALESCE(item->>'text', ''),
          'suggested_clip', '',
          'image_direction', ''
        )
      ELSE item
    END
    ORDER BY ord
  )
  FROM jsonb_array_elements(items) WITH ORDINALITY AS t(item, ord)
), items)
WHERE items IS NOT NULL;
