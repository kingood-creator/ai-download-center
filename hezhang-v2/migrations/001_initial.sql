CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(80) NOT NULL,
  email varchar(254) NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role varchar(16) NOT NULL CHECK (role IN ('admin','member','auditor')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind varchar(16) NOT NULL CHECK (kind IN ('reimbursement','aa')),
  status varchar(16) NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','disputed','voided')),
  item varchar(160) NOT NULL,
  category varchar(60) NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  occurred_on date NOT NULL,
  note varchar(1000) NOT NULL DEFAULT '',
  payer_id uuid NOT NULL REFERENCES users(id),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE expense_participants (
  expense_id uuid NOT NULL REFERENCES expenses(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id),
  share_cents integer NOT NULL CHECK (share_cents >= 0),
  PRIMARY KEY (expense_id, user_id)
);
CREATE TABLE vouchers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id uuid NOT NULL REFERENCES expenses(id) ON DELETE RESTRICT,
  stored_name text NOT NULL UNIQUE,
  original_name varchar(255) NOT NULL,
  mime_type varchar(100) NOT NULL,
  byte_size integer NOT NULL CHECK (byte_size > 0),
  uploaded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE reversals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_expense_id uuid NOT NULL REFERENCES expenses(id) ON DELETE RESTRICT,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  reason varchar(1000) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  requested_by uuid NOT NULL REFERENCES users(id),
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  review_note varchar(1000) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reviewed_only_when_decided CHECK ((status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL) OR (status <> 'pending' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE TABLE comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id uuid NOT NULL REFERENCES expenses(id) ON DELETE RESTRICT,
  author_id uuid NOT NULL REFERENCES users(id),
  body varchar(2000) NOT NULL,
  is_objection boolean NOT NULL DEFAULT false,
  resolved_at timestamptz,
  resolved_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT objections_are_resolved_together CHECK ((resolved_at IS NULL AND resolved_by IS NULL) OR (resolved_at IS NOT NULL AND resolved_by IS NOT NULL))
);
CREATE TABLE audit_events (
  id bigserial PRIMARY KEY,
  actor_id uuid REFERENCES users(id),
  entity_type varchar(40) NOT NULL,
  entity_id uuid,
  action varchar(80) NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX expenses_occurred_idx ON expenses(occurred_on DESC);
CREATE INDEX reversals_original_idx ON reversals(original_expense_id);
CREATE INDEX comments_expense_idx ON comments(expense_id, created_at);
