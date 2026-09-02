-- Ryan named "Phil Rosenthal" as one of his recurring clients, but that
-- name wasn't recognizable anywhere in the tracker -- caused real
-- confusion about whether a client was missing. Investigated and
-- confirmed: Phil Rosenthal (co-host of "Naked Lunch" with David Wild,
-- also known for Netflix's "Somebody Feed Phil") IS the existing "Naked
-- Lunch" / "Lucky Bastards Inc." line, already tracked at $4,375.00/mo.
-- Not a missing client -- just an unrecognizable label. Adding his name
-- to the notes so this doesn't get re-flagged as "missing" again.
-- Also renaming the counterparty label itself (not just the notes) --
-- the Recurring checklist card displays counterparty as the visible
-- label, so "Naked Lunch" alone was the actual source of the confusion.
UPDATE cashflow_entries
   SET counterparty = 'Naked Lunch (Phil Rosenthal)',
       notes = 'Phil Rosenthal''s podcast, co-hosted with David Wild. Billed in QuickBooks under his management company, "Lucky Bastards Inc." (Ground Control Century City business management, invoice #1814-#2071, Nov 2024-Aug 2026, one every month, zero gaps, paid via AgilLink autopay). Real QuickBooks sales: exact steady $4,375/mo every month, Jan-Aug 2026.'
 WHERE counterparty = 'Naked Lunch' AND kind = 'in' AND occurred_on = '2026-08-01';
