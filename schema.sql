CREATE TABLE quote_bot_quotes (
    id INT NOT NULL AUTO_INCREMENT,
    quote_text TEXT NOT NULL,
    quoted_person VARCHAR(100) NOT NULL,
    added_by_user_id VARCHAR(30) NOT NULL,
    added_by_username VARCHAR(100) NOT NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    used_in_daily_cycle TINYINT(1) NOT NULL DEFAULT 0,
    PRIMARY KEY (id)
);

CREATE TABLE quote_bot_reminders (
    id INT NOT NULL AUTO_INCREMENT,
    user_id VARCHAR(32) NOT NULL,
    username VARCHAR(100) NOT NULL,
    reminder_message TEXT NOT NULL,
    remind_at DATETIME NOT NULL,
    has_triggered TINYINT(1) NOT NULL DEFAULT 0,
    is_active TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_user_id (user_id),
    KEY idx_remind_at (remind_at),
    KEY idx_active (is_active),
    KEY idx_triggered (has_triggered)
);

CREATE TABLE quote_bot_birthdays (
    id INT NOT NULL AUTO_INCREMENT,
    birthday_user_id VARCHAR(32) NOT NULL,
    birthday_username VARCHAR(100) NOT NULL,
    month INT NOT NULL,
    day INT NOT NULL,
    created_by_user_id VARCHAR(32) NOT NULL,
    created_by_username VARCHAR(100) NOT NULL,
    created_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY unique_birthday_user (birthday_user_id)
);