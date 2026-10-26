CREATE TABLE `delivery_notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`role` text NOT NULL,
	`result_extid` text NOT NULL,
	`trace_guid` text,
	`request_id` text,
	`raw_webhook_body` text NOT NULL,
	`raw_result` text,
	`error_message` text,
	`errors` text,
	`fetch_error` text,
	`received_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `delivery_notifications_result_extid_unq` ON `delivery_notifications` (`result_extid`);