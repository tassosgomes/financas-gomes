CREATE TABLE "job_executions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"job_name" text NOT NULL,
	"logical_window" text NOT NULL,
	"execution_id" text NOT NULL,
	"attempt" integer NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"error_code" text,
	"correlation_id" text,
	CONSTRAINT "job_executions_job_name_allowlist_check" CHECK ("job_executions"."job_name" in ($1, $2)),
	CONSTRAINT "job_executions_status_allowlist_check" CHECK ("job_executions"."status" in ($1, $2, $3, $4)),
	CONSTRAINT "job_executions_logical_window_shape_check" CHECK ("job_executions"."logical_window" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
	CONSTRAINT "job_executions_execution_id_shape_check" CHECK (char_length(btrim("job_executions"."execution_id")) between 1 and 160),
	CONSTRAINT "job_executions_attempt_positive_check" CHECK ("job_executions"."attempt" between 1 and 99),
	CONSTRAINT "job_executions_error_code_shape_check" CHECK ("job_executions"."error_code" is null or (
        char_length(btrim("job_executions"."error_code")) between 1 and 64
        and "job_executions"."error_code" ~ '^[A-Z][A-Z0-9_]{0,63}$'
      )),
	CONSTRAINT "job_executions_correlation_id_shape_check" CHECK ("job_executions"."correlation_id" is null or (
        char_length(btrim("job_executions"."correlation_id")) between 1 and 160
      )),
	CONSTRAINT "job_executions_finished_at_shape_check" CHECK ((
        ("job_executions"."status"::text = 'RUNNING' and "job_executions"."finished_at" is null)
        or
        ("job_executions"."status"::text <> 'RUNNING' and "job_executions"."finished_at" is not null)
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "job_executions_job_name_logical_window_uq" ON "job_executions" USING btree ("job_name","logical_window");--> statement-breakpoint
CREATE INDEX "job_executions_started_at_idx" ON "job_executions" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "job_executions_job_name_started_at_idx" ON "job_executions" USING btree ("job_name","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_movements_household_source_reference_uq" ON "budget_movements" USING btree ("household_id","source_reference_id") WHERE "budget_movements"."source_reference_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "budget_movements_household_account_entry_uq" ON "budget_movements" USING btree ("household_id","account_entry_id") WHERE "budget_movements"."account_entry_id" is not null;