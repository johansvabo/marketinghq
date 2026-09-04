CREATE TABLE `assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`brief` text NOT NULL,
	`client_id` text,
	`project_id` text,
	`status` text DEFAULT 'running' NOT NULL,
	`synthesis` text,
	`error` text,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `assignments_status` ON `assignments` (`status`);--> statement-breakpoint
CREATE INDEX `assignments_created` ON `assignments` (`created_at`);--> statement-breakpoint
CREATE TABLE `contributions` (
	`id` text PRIMARY KEY NOT NULL,
	`assignment_id` text NOT NULL,
	`agent_key` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`body` text,
	`sources` text DEFAULT '[]',
	`error` text,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`assignment_id`) REFERENCES `assignments`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contribution_agent` ON `contributions` (`assignment_id`,`agent_key`);--> statement-breakpoint
CREATE INDEX `contributions_status` ON `contributions` (`status`);