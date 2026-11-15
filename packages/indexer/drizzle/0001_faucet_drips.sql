CREATE TABLE "zal_app"."faucet_drips" (
	"id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "zal_app"."faucet_drips_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"chain_id" integer NOT NULL,
	"wallet" text NOT NULL,
	"ip" text NOT NULL,
	"amount_wei" text NOT NULL,
	"tx_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "faucet_drips_wallet" ON "zal_app"."faucet_drips" USING btree ("chain_id","wallet","created_at");--> statement-breakpoint
CREATE INDEX "faucet_drips_ip" ON "zal_app"."faucet_drips" USING btree ("chain_id","ip","created_at");