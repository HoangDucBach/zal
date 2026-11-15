CREATE SCHEMA IF NOT EXISTS "zal_app";
--> statement-breakpoint
CREATE TABLE "zal_app"."auth_nonces" (
	"nonce" text PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "zal_app"."invites" (
	"id" text PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"proposer" text NOT NULL,
	"proposer_role" smallint NOT NULL,
	"invitee_email_hash" text NOT NULL,
	"nonce" text NOT NULL,
	"deadline" bigint NOT NULL,
	"signature" text NOT NULL,
	"signer" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_proposer_nonce" UNIQUE("chain_id","proposer","nonce")
);
--> statement-breakpoint
CREATE TABLE "zal_app"."layouts" (
	"chain_id" integer NOT NULL,
	"account" text NOT NULL,
	"layout" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" text NOT NULL,
	CONSTRAINT "layouts_chain_id_account_pk" PRIMARY KEY("chain_id","account")
);
--> statement-breakpoint
CREATE TABLE "zal_app"."notification_reads" (
	"chain_id" integer NOT NULL,
	"wallet" text NOT NULL,
	"key" text NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_reads_chain_id_wallet_key_pk" PRIMARY KEY("chain_id","wallet","key")
);
--> statement-breakpoint
CREATE TABLE "zal_app"."sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"chain_id" integer NOT NULL,
	"wallet" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "sessions_wallet" ON "zal_app"."sessions" USING btree ("wallet");