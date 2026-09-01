-- NOTE: the copy below selects literals for `billing_model` and `hourly_rate`.
-- They are new in this migration, so the old `clients` table has no such columns
-- to read from; selecting them by name makes the INSERT fail, and the DROP TABLE
-- that follows is not rolled back by every driver. Generated code had it wrong.

CREATE TABLE `time_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`project_id` text,
	`date` text NOT NULL,
	`hours` real NOT NULL,
	`note` text,
	`billable` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `time_client_date` ON `time_entries` (`client_id`,`date`);--> statement-breakpoint
CREATE INDEX `time_date` ON `time_entries` (`date`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_clients` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`color` text DEFAULT '#6366f1' NOT NULL,
	`engagement` text DEFAULT 'retainer' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`notes` text,
	`billing_model` text DEFAULT 'retainer' NOT NULL,
	`monthly_value` real,
	`hourly_rate` real,
	`currency` text DEFAULT 'NOK' NOT NULL,
	`email_domains` text DEFAULT '[]',
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_clients`("id", "name", "slug", "color", "engagement", "status", "notes", "billing_model", "monthly_value", "hourly_rate", "currency", "email_domains", "created_at", "updated_at") SELECT "id", "name", "slug", "color", "engagement", "status", "notes", 'retainer', "monthly_value", NULL, "currency", "email_domains", "created_at", "updated_at" FROM `clients`;--> statement-breakpoint
DROP TABLE `clients`;--> statement-breakpoint
ALTER TABLE `__new_clients` RENAME TO `clients`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `clients_slug_unique` ON `clients` (`slug`);--> statement-breakpoint
UPDATE `clients` SET `currency` = 'NOK' WHERE `currency` = 'DKK';
