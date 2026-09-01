-- `btree_gist` supplies equality operator classes for UUIDs so the same
-- exclusion constraint can scope the daterange by household and card.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "credit_card_billing_rules"
  ADD CONSTRAINT "credit_card_billing_rules_no_overlap_excl"
  EXCLUDE USING gist (
    "household_id" WITH =,
    "card_id" WITH =,
    daterange(
      "effective_from",
      coalesce("effective_until", 'infinity'::date),
      '[)'
    ) WITH &&
  );
