ALTER TABLE `documents` ADD `author_agent` text;--> statement-breakpoint
ALTER TABLE `documents` ADD `status` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `insights` ADD `status` text DEFAULT 'active' NOT NULL;