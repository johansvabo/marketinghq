CREATE TABLE `ai_usage` (
	`id` text PRIMARY KEY NOT NULL,
	`surface` text NOT NULL,
	`agent_key` text,
	`model` text NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_write_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`web_searches` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ai_usage_created` ON `ai_usage` (`created_at`);--> statement-breakpoint
CREATE INDEX `ai_usage_surface` ON `ai_usage` (`surface`);
