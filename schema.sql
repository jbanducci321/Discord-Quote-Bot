DROP TABLE IF EXISTS quote_bot_quotes;

CREATE TABLE quote_bot_quotes (
    id INT NOT NULL AUTO_INCREMENT,
    quote_text TEXT NOT NULL,
    quoted_person VARCHAR(100) NOT NULL,
    added_by_user_id VARCHAR(30) NOT NULL,
    added_by_username VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
);