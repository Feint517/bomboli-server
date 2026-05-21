-- Fuzzy matching for typo-tolerant fallback.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Full-text search vector. Generated column: Postgres maintains it
-- automatically on every insert/update of title or description. Weight 'A'
-- (highest) on title, 'B' on description — title matches outrank body matches
-- in ts_rank.
ALTER TABLE listings ADD COLUMN "searchVector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('french', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('french', coalesce(description, '')), 'B')
  ) STORED;

-- GIN index over the tsvector for the @@ operator.
CREATE INDEX "listings_searchVector_gin"
  ON listings USING GIN ("searchVector");

-- Trigram index on title for fuzzy fallback (`similarity()` / `%`).
CREATE INDEX "listings_title_trgm"
  ON listings USING GIN (title gin_trgm_ops);
