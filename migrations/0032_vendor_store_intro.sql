-- Separate descriptions from employee policies without rewriting existing content.
ALTER TABLE welfare_vendors ADD COLUMN store_intro TEXT NOT NULL DEFAULT '';
