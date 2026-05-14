-- Expand allowed note section colors to match the richer folder color palette in UI.
ALTER TABLE public.note_sections
  DROP CONSTRAINT IF EXISTS note_sections_color_check;

ALTER TABLE public.note_sections
  ADD CONSTRAINT note_sections_color_check
  CHECK (
    color IN (
      'blue',
      'orange',
      'purple',
      'green',
      'pink',
      'gray',
      'red',
      'amber',
      'teal',
      'cyan',
      'indigo',
      'violet',
      'emerald',
      'rose',
      'slate'
    )
  );
