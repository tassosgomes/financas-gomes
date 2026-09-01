ALTER TABLE "transaction_import_items" DROP CONSTRAINT "transaction_import_items_external_id_check";--> statement-breakpoint
ALTER TABLE "transaction_import_staging" DROP CONSTRAINT "transaction_import_staging_source_file_size_check";--> statement-breakpoint
ALTER TABLE "transaction_import_staging" DROP CONSTRAINT "transaction_import_staging_processed_rows_check";--> statement-breakpoint
ALTER TABLE "transaction_import_staging" DROP CONSTRAINT "transaction_import_staging_valid_rows_check";--> statement-breakpoint
ALTER TABLE "transaction_import_staging" DROP CONSTRAINT "transaction_import_staging_invalid_rows_check";--> statement-breakpoint
ALTER TABLE "transaction_imports" DROP CONSTRAINT "transaction_imports_source_file_size_check";--> statement-breakpoint
ALTER TABLE "transaction_imports" DROP CONSTRAINT "transaction_imports_processed_rows_check";--> statement-breakpoint
ALTER TABLE "transaction_imports" DROP CONSTRAINT "transaction_imports_valid_rows_check";--> statement-breakpoint
ALTER TABLE "transaction_imports" DROP CONSTRAINT "transaction_imports_invalid_rows_check";--> statement-breakpoint
ALTER TABLE "transaction_imports" DROP CONSTRAINT "transaction_imports_ignored_duplicate_rows_check";--> statement-breakpoint
ALTER TABLE "transaction_imports" DROP CONSTRAINT "transaction_imports_imported_rows_check";--> statement-breakpoint
ALTER TABLE "transaction_import_items" ADD CONSTRAINT "transaction_import_items_external_id_check" CHECK ("transaction_import_items"."external_id" is null
        or (char_length("transaction_import_items"."external_id") between 1 and 128
          and "transaction_import_items"."external_id" !~ '[[:cntrl:]]'));--> statement-breakpoint
ALTER TABLE "transaction_import_staging" ADD CONSTRAINT "transaction_import_staging_source_file_size_check" CHECK ("transaction_import_staging"."source_file_size_bytes" between 0 and 5242880);--> statement-breakpoint
ALTER TABLE "transaction_import_staging" ADD CONSTRAINT "transaction_import_staging_processed_rows_check" CHECK ("transaction_import_staging"."processed_rows" between 1 and 10000);--> statement-breakpoint
ALTER TABLE "transaction_import_staging" ADD CONSTRAINT "transaction_import_staging_valid_rows_check" CHECK ("transaction_import_staging"."valid_rows" between 1 and 10000);--> statement-breakpoint
ALTER TABLE "transaction_import_staging" ADD CONSTRAINT "transaction_import_staging_invalid_rows_check" CHECK ("transaction_import_staging"."invalid_rows" between 0 and 10000);--> statement-breakpoint
ALTER TABLE "transaction_imports" ADD CONSTRAINT "transaction_imports_source_file_size_check" CHECK ("transaction_imports"."source_file_size_bytes" between 0 and 5242880);--> statement-breakpoint
ALTER TABLE "transaction_imports" ADD CONSTRAINT "transaction_imports_processed_rows_check" CHECK ("transaction_imports"."processed_rows" between 0 and 10000);--> statement-breakpoint
ALTER TABLE "transaction_imports" ADD CONSTRAINT "transaction_imports_valid_rows_check" CHECK ("transaction_imports"."valid_rows" between 0 and 10000);--> statement-breakpoint
ALTER TABLE "transaction_imports" ADD CONSTRAINT "transaction_imports_invalid_rows_check" CHECK ("transaction_imports"."invalid_rows" between 0 and 10000);--> statement-breakpoint
ALTER TABLE "transaction_imports" ADD CONSTRAINT "transaction_imports_ignored_duplicate_rows_check" CHECK ("transaction_imports"."ignored_duplicate_rows" between 0 and 10000);--> statement-breakpoint
ALTER TABLE "transaction_imports" ADD CONSTRAINT "transaction_imports_imported_rows_check" CHECK ("transaction_imports"."imported_rows" between 0 and 10000);