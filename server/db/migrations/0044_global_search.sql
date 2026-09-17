CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.flow_search_normalize(value text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT translate(lower(coalesce(value, '')), 'áéíóúüñ', 'aeiouun')
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.flow_search_text(value jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
 SELECT public.flow_search_normalize(coalesce(string_agg(item #>> '{}', ' '), ''))
 FROM jsonb_path_query(value, '$.** ? (@.type() == "string" || @.type() == "number" || @.type() == "boolean")') item
$$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS records_global_search_trgm_idx
 ON records USING gin (public.flow_search_text(custom_data) gin_trgm_ops)
 WHERE deleted_at IS NULL;
