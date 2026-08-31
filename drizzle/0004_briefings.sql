CREATE TABLE `briefings` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_key` text NOT NULL,
	`client_id` text,
	`slot_key` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`title` text,
	`body` text,
	`sources` text DEFAULT '[]',
	`error` text,
	`read_at` integer,
	`pinned_at` integer,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `briefings_slot` ON `briefings` (`agent_key`,`client_id`,`slot_key`);--> statement-breakpoint
CREATE INDEX `briefings_status` ON `briefings` (`status`);--> statement-breakpoint
CREATE INDEX `briefings_unread` ON `briefings` (`read_at`,`created_at`);