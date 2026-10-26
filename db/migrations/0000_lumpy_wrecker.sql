CREATE TABLE `invoices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`invoice_number` text NOT NULL,
	`invoiced_at` text NOT NULL,
	`total` real NOT NULL,
	`submission_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`submission_id`) REFERENCES `outbound_submissions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `order_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`line_number` integer NOT NULL,
	`sku` text NOT NULL,
	`buyer_item_number` text,
	`description` text NOT NULL,
	`quantity_ordered` real NOT NULL,
	`unit_of_measure` text NOT NULL,
	`unit_price` real NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`po_number` text NOT NULL,
	`partner` text NOT NULL,
	`status` text DEFAULT 'received' NOT NULL,
	`order_date` text NOT NULL,
	`requested_ship_date` text,
	`currency` text DEFAULT 'USD' NOT NULL,
	`ship_to_name` text NOT NULL,
	`ship_to_address1` text NOT NULL,
	`ship_to_address2` text,
	`ship_to_city` text NOT NULL,
	`ship_to_state` text NOT NULL,
	`ship_to_postal_code` text NOT NULL,
	`ship_to_country` text DEFAULT 'US' NOT NULL,
	`order_total` real NOT NULL,
	`notes` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_partner_po_unq` ON `orders` (`partner`,`po_number`);--> statement-breakpoint
CREATE TABLE `outbound_submissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer,
	`ts_code` text NOT NULL,
	`request_payload` text NOT NULL,
	`response_status` integer,
	`response_body` text,
	`outcome` text NOT NULL,
	`submitted_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `received_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`result_extid` text NOT NULL,
	`trace_guid` text,
	`request_id` text,
	`raw_webhook_body` text NOT NULL,
	`raw_fetched_payload` text,
	`status` text DEFAULT 'received' NOT NULL,
	`error` text,
	`order_id` integer,
	`received_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `received_documents_result_extid_unq` ON `received_documents` (`result_extid`);--> statement-breakpoint
CREATE TABLE `shipments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_id` integer NOT NULL,
	`shipment_number` text NOT NULL,
	`shipped_at` text NOT NULL,
	`carrier` text NOT NULL,
	`tracking_number` text,
	`submission_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`submission_id`) REFERENCES `outbound_submissions`(`id`) ON UPDATE no action ON DELETE no action
);
