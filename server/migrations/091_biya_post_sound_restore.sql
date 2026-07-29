-- One-time guard to restore the single line item the detailed-budget revert
-- wrongly zeroed: 48-00 "sound designer" held Ryan's real $20,000, which
-- collided with a loaded amount and got caught by the value-matching revert.
-- His day-budget data was never affected — this fixes only that one item.
ALTER TABLE budgets ADD COLUMN IF NOT EXISTS post_sound_restored boolean NOT NULL DEFAULT false;
