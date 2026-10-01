CREATE TABLE IF NOT EXISTS members (
  id CHAR(32) PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  email VARCHAR(254) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  google_sub VARCHAR(255) NULL,
  UNIQUE KEY members_email (email),
  UNIQUE KEY members_google_sub (google_sub)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE members ADD COLUMN IF NOT EXISTS google_sub VARCHAR(255) NULL;
CREATE UNIQUE INDEX IF NOT EXISTS members_google_sub ON members (google_sub);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64) PRIMARY KEY,
  member_id CHAR(32) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  CONSTRAINT sessions_member FOREIGN KEY (member_id) REFERENCES members (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS blocks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  prev_hash CHAR(64) NOT NULL,
  hash CHAR(64) NOT NULL,
  entry_type VARCHAR(32) NOT NULL,
  payload JSON NOT NULL,
  created_at_iso VARCHAR(32) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY blocks_hash (hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS treasury (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  cash_cents BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS claims (
  member_id CHAR(32) NOT NULL PRIMARY KEY,
  claim_cents BIGINT NOT NULL,
  CONSTRAINT claims_member FOREIGN KEY (member_id) REFERENCES members (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS investments (
  id CHAR(32) NOT NULL PRIMARY KEY,
  symbol VARCHAR(16) NOT NULL,
  name VARCHAR(80) NOT NULL,
  units_micro BIGINT NOT NULL,
  cost_cents BIGINT NOT NULL,
  price_cents BIGINT NOT NULL,
  opened_at DATETIME(3) NOT NULL,
  prior_close_cents BIGINT NULL,
  close_session DATE NULL,
  prior_session DATE NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE investments ADD COLUMN IF NOT EXISTS prior_close_cents BIGINT NULL;
ALTER TABLE investments ADD COLUMN IF NOT EXISTS close_session DATE NULL;
ALTER TABLE investments ADD COLUMN IF NOT EXISTS prior_session DATE NULL;

CREATE TABLE IF NOT EXISTS investment_marks (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  investment_id CHAR(32) NOT NULL,
  price_cents BIGINT NOT NULL,
  marked_at DATETIME(3) NOT NULL,
  session_date DATE NULL,
  CONSTRAINT marks_investment FOREIGN KEY (investment_id) REFERENCES investments (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE investment_marks ADD COLUMN IF NOT EXISTS session_date DATE NULL;

CREATE TABLE IF NOT EXISTS payments (
  id CHAR(32) NOT NULL PRIMARY KEY,
  member_id CHAR(32) NOT NULL,
  idempotency_key VARCHAR(64) NOT NULL,
  kind VARCHAR(16) NOT NULL,
  amount_cents BIGINT NOT NULL,
  counterparty_id CHAR(32) NULL,
  phone VARCHAR(15) NULL,
  status VARCHAR(16) NOT NULL,
  checkout_request_id VARCHAR(80) NULL,
  merchant_request_id VARCHAR(80) NULL,
  mpesa_receipt VARCHAR(32) NULL,
  result_code VARCHAR(16) NULL,
  block_id BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY payments_member_key (member_id, idempotency_key),
  UNIQUE KEY payments_checkout (checkout_request_id),
  CONSTRAINT payments_member FOREIGN KEY (member_id) REFERENCES members (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admins (
  id CHAR(32) PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  email VARCHAR(254) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY admins_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS desk_sessions (
  token_hash CHAR(64) PRIMARY KEY,
  admin_id CHAR(32) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  CONSTRAINT desk_sessions_admin FOREIGN KEY (admin_id) REFERENCES admins (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS loan_products (
  code VARCHAR(16) NOT NULL PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  interest_percent SMALLINT NOT NULL,
  term_min SMALLINT NOT NULL,
  term_max SMALLINT NOT NULL,
  term_unit VARCHAR(8) NOT NULL,
  minimum_cents BIGINT NOT NULL,
  maximum_cents BIGINT NOT NULL,
  minimum_guarantors TINYINT NOT NULL,
  coverage_percent SMALLINT NOT NULL,
  fee_percent SMALLINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS loan_applications (
  id CHAR(32) NOT NULL PRIMARY KEY,
  member_id CHAR(32) NOT NULL,
  product_code VARCHAR(16) NOT NULL,
  amount_cents BIGINT NOT NULL,
  term_count SMALLINT NOT NULL,
  purpose VARCHAR(500) NOT NULL,
  phone VARCHAR(15) NOT NULL,
  status VARCHAR(32) NOT NULL,
  recommended_cents BIGINT NULL,
  approved_cents BIGINT NULL,
  approved_term SMALLINT NULL,
  risk_rating VARCHAR(16) NULL,
  appraisal_notes VARCHAR(2000) NULL,
  decision_notes VARCHAR(1000) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT loan_applications_member FOREIGN KEY (member_id) REFERENCES members (id),
  CONSTRAINT loan_applications_product FOREIGN KEY (product_code) REFERENCES loan_products (code),
  INDEX loan_applications_member (member_id, status),
  INDEX loan_applications_status (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS loan_guarantors (
  id CHAR(32) NOT NULL PRIMARY KEY,
  application_id CHAR(32) NOT NULL,
  member_id CHAR(32) NOT NULL,
  amount_cents BIGINT NOT NULL,
  status VARCHAR(16) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  CONSTRAINT loan_guarantors_application FOREIGN KEY (application_id) REFERENCES loan_applications (id),
  CONSTRAINT loan_guarantors_member FOREIGN KEY (member_id) REFERENCES members (id),
  INDEX loan_guarantors_member (member_id, status),
  INDEX loan_guarantors_application (application_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS loans (
  id CHAR(32) NOT NULL PRIMARY KEY,
  application_id CHAR(32) NOT NULL,
  member_id CHAR(32) NOT NULL,
  principal_cents BIGINT NOT NULL,
  fee_cents BIGINT NOT NULL,
  net_cents BIGINT NOT NULL,
  status VARCHAR(16) NOT NULL,
  payment_id CHAR(32) NULL,
  disbursed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  UNIQUE KEY loans_application (application_id),
  UNIQUE KEY loans_payment (payment_id),
  CONSTRAINT loans_application FOREIGN KEY (application_id) REFERENCES loan_applications (id),
  CONSTRAINT loans_member FOREIGN KEY (member_id) REFERENCES members (id),
  CONSTRAINT loans_payment FOREIGN KEY (payment_id) REFERENCES payments (id),
  INDEX loans_member (member_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
