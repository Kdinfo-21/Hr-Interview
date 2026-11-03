-- Migration 001: add recruiter login/registration support.
--
-- Safe to run directly against your existing Neon database (the one you
-- exported in "CREATE SCHEMA - (1).txt"). It only ADDS a new table — nothing
-- existing is touched, dropped, or renamed, and it's idempotent (IF NOT
-- EXISTS everywhere), so re-running it is harmless.
--
-- Run it in the Neon SQL editor, or:
--   psql "$DATABASE_URL" -f backend_python/migrations/001_add_recruiters.sql

CREATE TABLE IF NOT EXISTS "recruiters" (
	"recruiter_id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "recruiters_recruiter_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"name" varchar(200) NOT NULL,
	"email" varchar(200) NOT NULL,
	"password_hash" varchar(255) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"last_login_at" timestamp with time zone
);

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_constraint WHERE conname = 'recruiters_email_key'
	) THEN
		ALTER TABLE "recruiters" ADD CONSTRAINT "recruiters_email_key" UNIQUE ("email");
	END IF;
END $$;

CREATE INDEX IF NOT EXISTS "idx_recruiters_email" ON "recruiters" ("email");
