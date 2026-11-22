-- Explicit administrator grants are separate from reusable QR-only codes.
-- Existing bindings retain their status, source and timestamps with no new grant.
ALTER TABLE welfare_vendor_line_bindings
  ADD COLUMN management_enabled INTEGER NOT NULL DEFAULT 0 CHECK(management_enabled IN (0,1));
