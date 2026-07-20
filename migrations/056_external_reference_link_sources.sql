ALTER TABLE public.external_reference_links
  ADD COLUMN IF NOT EXISTS sources TEXT[] NOT NULL DEFAULT ARRAY['manual']::TEXT[];

UPDATE public.external_reference_links
SET sources = ARRAY['manual']::TEXT[]
WHERE sources IS NULL OR cardinality(sources) = 0;

ALTER TABLE public.external_reference_links
  DROP CONSTRAINT IF EXISTS external_reference_links_sources_check;

ALTER TABLE public.external_reference_links
  ADD CONSTRAINT external_reference_links_sources_check
  CHECK (sources <@ ARRAY['embed', 'manual', 'conversion', 'integration']::TEXT[]);

CREATE INDEX IF NOT EXISTS idx_external_reference_links_sources
  ON public.external_reference_links USING GIN (sources);
