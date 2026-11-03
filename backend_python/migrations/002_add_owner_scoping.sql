-- Migration 002: per-recruiter data ownership (tenant isolation).
--
-- Every recruiter now only sees rows they own. This adds an owner_id to the
-- three top-level tables; everything else (questions, responses, scores,
-- challenges, proctoring events, ...) hangs off interviews and inherits
-- ownership through interview_id.
--
-- Safe and idempotent: it only ADDS columns/indexes, replaces the old
-- "one candidate per email across the whole system" uniqueness with "one
-- candidate per email PER RECRUITER", and backfills existing rows. It runs
-- automatically when the API starts (see app/db/migrations.py) and can also
-- be run by hand:
--   psql "$DATABASE_URL" -f backend_python/migrations/002_add_owner_scoping.sql

-- Serialise concurrent startups so two workers can't race on the DDL below.
SELECT pg_advisory_xact_lock(727002);

ALTER TABLE candidates    ADD COLUMN IF NOT EXISTS owner_id INT REFERENCES recruiters(recruiter_id);
ALTER TABLE interviews    ADD COLUMN IF NOT EXISTS owner_id INT REFERENCES recruiters(recruiter_id);
ALTER TABLE question_sets ADD COLUMN IF NOT EXISTS owner_id INT REFERENCES recruiters(recruiter_id);

CREATE INDEX IF NOT EXISTS idx_candidates_owner    ON candidates(owner_id);
CREATE INDEX IF NOT EXISTS idx_interviews_owner    ON interviews(owner_id);
CREATE INDEX IF NOT EXISTS idx_question_sets_owner ON question_sets(owner_id);

-- candidates.email used to be globally UNIQUE, so recruiter B scheduling an
-- email that recruiter A already had would silently overwrite A's candidate.
-- Drop any unique constraint / unique index on email alone (whatever it is
-- named in this particular database) and replace it with (owner_id, email).
DO $$
DECLARE r record;
BEGIN
    FOR r IN
        SELECT c.conname
        FROM pg_constraint c
        WHERE c.conrelid = 'candidates'::regclass
          AND c.contype = 'u'
          AND array_length(c.conkey, 1) = 1
          AND (SELECT a.attname FROM pg_attribute a
               WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[1]) = 'email'
    LOOP
        EXECUTE format('ALTER TABLE candidates DROP CONSTRAINT %I', r.conname);
    END LOOP;

    FOR r IN
        SELECT i.relname
        FROM pg_index x
        JOIN pg_class i ON i.oid = x.indexrelid
        JOIN pg_attribute a ON a.attrelid = x.indrelid AND a.attnum = x.indkey[0]
        WHERE x.indrelid = 'candidates'::regclass
          AND x.indisunique AND NOT x.indisprimary
          AND x.indnatts = 1 AND x.indpred IS NULL
          AND a.attname = 'email'
    LOOP
        EXECUTE format('DROP INDEX IF EXISTS %I', r.relname);
    END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_candidates_owner_email ON candidates(owner_id, email);

-- Backfill rows that existed before per-recruiter ownership. They are
-- assigned to the earliest-registered recruiter account (normally the
-- project owner) so nothing disappears from that person's dashboard, and
-- they stop being visible to every other account. New rows always get the
-- creating recruiter's id, so this is a no-op after the first run.
-- To hand legacy data to a different account, run:
--   UPDATE candidates    SET owner_id = <id> WHERE owner_id = <old_id>;
--   UPDATE interviews    SET owner_id = <id> WHERE owner_id = <old_id>;
--   UPDATE question_sets SET owner_id = <id> WHERE owner_id = <old_id>;
UPDATE candidates
   SET owner_id = (SELECT MIN(recruiter_id) FROM recruiters)
 WHERE owner_id IS NULL AND EXISTS (SELECT 1 FROM recruiters);

UPDATE interviews i
   SET owner_id = c.owner_id
  FROM candidates c
 WHERE i.candidate_id = c.candidate_id AND i.owner_id IS NULL AND c.owner_id IS NOT NULL;

UPDATE question_sets q
   SET owner_id = COALESCE(
         (SELECT c.owner_id FROM candidates c WHERE c.candidate_id = q.source_candidate_id),
         (SELECT MIN(recruiter_id) FROM recruiters))
 WHERE q.owner_id IS NULL AND EXISTS (SELECT 1 FROM recruiters);
