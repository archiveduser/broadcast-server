CREATE TABLE `rooms` (
  `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(32) NOT NULL,
  `token` VARCHAR(64) NOT NULL,
  `allow_api_query` BOOLEAN NOT NULL DEFAULT true,
  `created_at` BIGINT UNSIGNED NOT NULL DEFAULT 0,

  PRIMARY KEY (`id`),
  UNIQUE INDEX `rooms_name_key` (`name`),
  UNIQUE INDEX `rooms_token_key` (`token`),
  INDEX `idx_rooms_token` (`token`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `messages` (
  `id` INTEGER UNSIGNED NOT NULL AUTO_INCREMENT,
  `room_id` INTEGER UNSIGNED NOT NULL,
  `key` VARCHAR(64) NOT NULL,
  `value_json` JSON NOT NULL,
  `created_at` BIGINT UNSIGNED NOT NULL DEFAULT 0,

  PRIMARY KEY (`id`),
  INDEX `idx_messages_room_id` (`room_id`, `id`),
  INDEX `idx_messages_created` (`created_at`, `id`),
  CONSTRAINT `messages_room_id_fkey` FOREIGN KEY (`room_id`) REFERENCES `rooms` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
