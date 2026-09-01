-- T05: tenancy root, memberships and copyable invite records.
-- The Better Auth `user` table is created by T04 and must be applied first.
CREATE TABLE "households" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "household_members" (
	"household_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "household_members_pkey" PRIMARY KEY("household_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "household_invites" (
	"id" uuid PRIMARY KEY NOT NULL,
	"household_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "household_members"
	ADD CONSTRAINT "household_members_household_id_fkey"
	FOREIGN KEY ("household_id") REFERENCES "public"."households"("id")
	ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "household_members"
	ADD CONSTRAINT "household_members_user_id_fkey"
	FOREIGN KEY ("user_id") REFERENCES "public"."user"("id")
	ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "household_invites"
	ADD CONSTRAINT "household_invites_household_id_fkey"
	FOREIGN KEY ("household_id") REFERENCES "public"."households"("id")
	ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "household_invites"
	ADD CONSTRAINT "household_invites_created_by_fkey"
	FOREIGN KEY ("created_by") REFERENCES "public"."user"("id")
	ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "household_invites"
	ADD CONSTRAINT "household_invites_creator_member_fkey"
	FOREIGN KEY ("household_id", "created_by")
	REFERENCES "public"."household_members"("household_id", "user_id")
	ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "household_invites_token_hash_uq"
	ON "household_invites" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX "household_members_user_id_idx"
	ON "household_members" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "household_invites_household_id_idx"
	ON "household_invites" USING btree ("household_id");
--> statement-breakpoint
CREATE INDEX "household_invites_token_hash_expires_at_idx"
	ON "household_invites" USING btree ("token_hash", "expires_at");
--> statement-breakpoint
CREATE INDEX "household_invites_expires_at_idx"
	ON "household_invites" USING btree ("expires_at");
