--> Everything already finished has been seen. Without this, the first run
--> after notified_at shipped treats the entire back catalogue as unannounced
--> and mails it out.
UPDATE `assignments`
   SET `notified_at` = COALESCE(`completed_at`, `updated_at`, unixepoch())
 WHERE `notified_at` IS NULL
   AND `status` IN ('ready', 'error');
