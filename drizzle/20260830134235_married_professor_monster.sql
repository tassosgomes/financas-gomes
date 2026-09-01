ALTER TABLE "financial_events" DROP CONSTRAINT "financial_events_reversal_shape_check";--> statement-breakpoint
ALTER TABLE "financial_events" ADD CONSTRAINT "financial_events_reversal_shape_check" CHECK ((
        ("financial_events"."kind" = 'REVERSAL'
          and "financial_events"."origin" = 'SYSTEM'
          and "financial_events"."status" = 'POSTED'
          and "financial_events"."reversal_of_event_id" is not null)
        or
        ("financial_events"."kind" <> 'REVERSAL'
          and "financial_events"."origin"::text in ('MANUAL', 'IMPORT')
          and ("financial_events"."origin"::text = 'MANUAL' or "financial_events"."status" = 'POSTED')
          and "financial_events"."reversal_of_event_id" is null)
      ));