CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text,
	`project_id` text,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`kind` text DEFAULT 'note' NOT NULL,
	`tags` text DEFAULT '[]',
	`pinned` integer DEFAULT false NOT NULL,
	`source` text DEFAULT 'manual' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `documents_client` ON `documents` (`client_id`);--> statement-breakpoint
CREATE INDEX `documents_kind` ON `documents` (`kind`);