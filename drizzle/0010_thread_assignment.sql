-- NOTE: written by hand. Drizzle generates this ADD COLUMN without the
-- ON DELETE CASCADE the schema declares, which SQLite is happy to accept and
-- then enforces as a plain restrict: deleting an assignment that someone had
-- a follow-up conversation about failed with a foreign-key error instead of
-- taking the conversation with it. ADD COLUMN does accept the clause.
ALTER TABLE `chat_threads` ADD `assignment_id` text REFERENCES assignments(id) ON DELETE CASCADE;