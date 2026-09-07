-- Ana (Ana Clara Munoz, graphic designer) confirmed via a real bank
-- statement screenshot: "ACH ORIG DEBIT ANA CLARA MUNOZ -$120.00" --
-- direct, primary-source evidence of the real rate. Corrects migration
-- 130's $541.67/mo estimate, which was based on Ryan's own recollection
-- of "$125/wk" in an earlier Slack conversation -- the real, bank-
-- confirmed rate is $120/wk = $520.00/mo.
UPDATE cashflow_entries
   SET amount_cents = 52000,
       notes = 'Graphic design (Ana Clara Munoz). Confirmed via a real bank statement screenshot: recurring ACH debit of exactly $120.00/wk = $520.00/mo. This replaces the earlier $541.67/mo estimate (based on Ryan''s recollection of "$125/wk") with the actual bank record.'
 WHERE counterparty = 'Ana' AND category = 'Staff' AND kind = 'out' AND occurred_on = '2026-08-01';
