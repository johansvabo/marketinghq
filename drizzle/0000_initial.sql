-- Baseline schema.
--
-- Deliberately written with IF NOT EXISTS: databases created before
-- migrations existed (via `drizzle-kit push`) already have these tables but
-- no migration record, and this file has to apply cleanly over them as well
-- as over an empty database. Later migrations are ALTERs and need no such
-- guard — everyone is on the migration track from here.

CREATE TABLE IF NOT EXISTS `briefs` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`headline` text,
	`body` text,
	`stats` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `briefs_date_unique` ON `briefs` (`date`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `calendar_events` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text,
	`client_id` text,
	`project_id` text,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`location` text,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`is_all_day` integer DEFAULT false NOT NULL,
	`attendees` text DEFAULT '[]',
	`organizer_email` text,
	`is_external` integer DEFAULT false NOT NULL,
	`prep_task_id` text,
	`follow_up_task_id` text,
	`follow_up_done_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `events_provider_external` ON `calendar_events` (`provider`,`external_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `events_starts` ON `calendar_events` (`starts_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`tool_calls` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `chat_threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `chat_messages_thread` ON `chat_messages` (`thread_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `chat_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text DEFAULT 'New conversation' NOT NULL,
	`client_id` text,
	`project_id` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `clients` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`color` text DEFAULT '#6366f1' NOT NULL,
	`engagement` text DEFAULT 'retainer' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`notes` text,
	`monthly_value` real,
	`currency` text DEFAULT 'DKK' NOT NULL,
	`email_domains` text DEFAULT '[]',
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `clients_slug_unique` ON `clients` (`slug`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `connections` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`display_name` text,
	`access_token` text,
	`refresh_token` text,
	`expires_at` integer,
	`scopes` text,
	`config` text,
	`status` text DEFAULT 'connected' NOT NULL,
	`last_synced_at` integer,
	`last_error` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `connections_provider_external` ON `connections` (`provider`,`external_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `insights` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text,
	`project_id` text,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`kind` text DEFAULT 'insight' NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`source_ref` text,
	`tags` text DEFAULT '[]',
	`confidence` integer DEFAULT 3 NOT NULL,
	`pinned` integer DEFAULT false NOT NULL,
	`occurred_at` integer DEFAULT (unixepoch()) NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `insights_client` ON `insights` (`client_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `insights_kind` ON `insights` (`kind`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text,
	`client_id` text,
	`provider` text NOT NULL,
	`external_id` text NOT NULL,
	`thread_id` text,
	`subject` text,
	`from_name` text,
	`from_email` text,
	`to_emails` text DEFAULT '[]',
	`snippet` text,
	`body` text,
	`received_at` integer NOT NULL,
	`awaiting_reply` integer DEFAULT false NOT NULL,
	`is_from_me` integer DEFAULT false NOT NULL,
	`triaged_at` integer,
	`triage` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `messages_provider_external` ON `messages` (`provider`,`external_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `messages_received` ON `messages` (`received_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `messages_awaiting` ON `messages` (`awaiting_reply`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `metrics` (
	`id` text PRIMARY KEY NOT NULL,
	`connection_id` text,
	`client_id` text,
	`source` text NOT NULL,
	`date` text NOT NULL,
	`entity_type` text DEFAULT 'account' NOT NULL,
	`entity_id` text,
	`entity_name` text,
	`metric` text NOT NULL,
	`value` real NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `metrics_unique` ON `metrics` (`source`,`date`,`entity_id`,`metric`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `metrics_client_date` ON `metrics` (`client_id`,`date`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `metrics_lookup` ON `metrics` (`source`,`metric`,`date`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `milestones` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`due_date` integer NOT NULL,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `milestones_project` ON `milestones` (`project_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text,
	`name` text NOT NULL,
	`goal` text,
	`status` text DEFAULT 'active' NOT NULL,
	`health` text DEFAULT 'on_track' NOT NULL,
	`start_date` integer,
	`due_date` integer,
	`progress` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `projects_client` ON `projects` (`client_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `projects_status` ON `projects` (`status`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `report_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule_id` text,
	`client_id` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`due_at` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`draft` text,
	`data_snapshot` text,
	`sent_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`schedule_id`) REFERENCES `report_schedules`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `report_runs_status` ON `report_runs` (`status`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `report_runs_client` ON `report_runs` (`client_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `report_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`name` text NOT NULL,
	`cadence` text DEFAULT 'monthly' NOT NULL,
	`day_of` integer DEFAULT 1 NOT NULL,
	`lead_days` integer DEFAULT 3 NOT NULL,
	`sources` text DEFAULT '[]',
	`template` text,
	`recipients` text DEFAULT '[]',
	`active` integer DEFAULT true NOT NULL,
	`next_due_at` integer,
	`last_sent_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `report_schedules_due` ON `report_schedules` (`next_due_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `signals` (
	`id` text PRIMARY KEY NOT NULL,
	`dedupe_key` text NOT NULL,
	`rule` text NOT NULL,
	`severity` text DEFAULT 'important' NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`client_id` text,
	`project_id` text,
	`entity_type` text,
	`entity_id` text,
	`actions` text DEFAULT '[]',
	`score` real DEFAULT 0 NOT NULL,
	`snoozed_until` integer,
	`dismissed_at` integer,
	`acted_at` integer,
	`resolved_at` integer,
	`first_seen_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_seen_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `signals_dedupe_key_unique` ON `signals` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `signals_open` ON `signals` (`dismissed_at`,`score`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `stakeholders` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text,
	`name` text NOT NULL,
	`email` text,
	`role` text,
	`contact_cadence_days` integer DEFAULT 0 NOT NULL,
	`last_contact_at` integer,
	`receives_reports` integer DEFAULT false NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `stakeholders_client` ON `stakeholders` (`client_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`items_written` integer DEFAULT 0 NOT NULL,
	`message` text,
	`duration_ms` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sync_runs_source` ON `sync_runs` (`source`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`client_id` text,
	`title` text NOT NULL,
	`notes` text,
	`status` text DEFAULT 'todo' NOT NULL,
	`priority` integer DEFAULT 2 NOT NULL,
	`due_date` integer,
	`start_date` integer,
	`estimate_minutes` integer,
	`waiting_on` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`source_ref` text,
	`tags` text DEFAULT '[]',
	`completed_at` integer,
	`last_touched_at` integer DEFAULT (unixepoch()) NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `tasks_status_due` ON `tasks` (`status`,`due_date`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `tasks_project` ON `tasks` (`project_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `tasks_client` ON `tasks` (`client_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`timezone` text DEFAULT 'Europe/Copenhagen' NOT NULL,
	`workday_start` text DEFAULT '08:30' NOT NULL,
	`workday_end` text DEFAULT '17:00' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `users_email_unique` ON `users` (`email`);