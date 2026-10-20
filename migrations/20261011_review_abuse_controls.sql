-- SHRI JI COLLECTION: review abuse controls (additive, safe to re-run).
-- Adds ONE nullable column + an index. Does not change or delete any existing review, product or order.
-- Stores only a one-way hash of the visitor (never the raw IP address).

-- PREFLIGHT (optional): select count(*) from public.product_reviews;

alter table public.product_reviews add column if not exists submitter_hash text;
create index if not exists product_reviews_submitter_idx
  on public.product_reviews(submitter_hash, created_at desc) where submitter_hash is not null;

-- The public cannot read this column: anon/authenticated were granted SELECT on the table, so restrict columns.
revoke select on public.product_reviews from anon, authenticated;
grant select (id, product_id, customer_name, rating, comment, status, created_at, updated_at)
  on public.product_reviews to anon, authenticated;

-- ROLLBACK (only if ever needed; it removes just this column):
--   drop index if exists public.product_reviews_submitter_idx;
--   alter table public.product_reviews drop column if exists submitter_hash;
--   grant select on public.product_reviews to anon, authenticated;
