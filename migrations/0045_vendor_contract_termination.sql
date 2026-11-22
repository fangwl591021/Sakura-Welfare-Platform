-- Preserve historical vendor data and review status; an explicit termination
-- is separate from suspension and can be reversed when a contract is renewed.
ALTER TABLE welfare_vendors ADD COLUMN contract_terminated_at TEXT NOT NULL DEFAULT '';
ALTER TABLE welfare_vendors ADD COLUMN contract_terminated_by TEXT NOT NULL DEFAULT '';
