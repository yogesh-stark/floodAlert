-- StreetFlood Alert — PostgreSQL Relational Schema
-- Compatible with PostgreSQL 15+ (and mirrored in Firestore blueprint)

CREATE TYPE user_role AS ENUM ('resident', 'reporter', 'admin');
CREATE TYPE risk_level AS ENUM ('safe', 'watch', 'warning', 'danger');
CREATE TYPE sensor_status AS ENUM ('online', 'offline', 'low_battery');
CREATE TYPE alert_level AS ENUM ('watch', 'warning', 'danger', 'all_clear');
CREATE TYPE report_severity AS ENUM ('ankle', 'knee', 'waist', 'blocked_drain');
CREATE TYPE report_status AS ENUM ('unverified', 'verified', 'resolved');

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  firebase_uid VARCHAR(128) UNIQUE NOT NULL,
  display_name VARCHAR(100) NOT NULL,
  email VARCHAR(200) UNIQUE NOT NULL,
  phone VARCHAR(30),
  role user_role NOT NULL DEFAULT 'resident',
  preferred_lang VARCHAR(5) NOT NULL DEFAULT 'en',
  fcm_token TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE streets (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  name_ta VARCHAR(160) NOT NULL,
  area VARCHAR(100) NOT NULL,
  coordinates_json JSONB NOT NULL, -- Array of [lat, lng] polyline vertices
  drain_depth_cm NUMERIC(6, 2) NOT NULL CHECK (drain_depth_cm > 0),
  watch_pct NUMERIC(5, 2) NOT NULL DEFAULT 50.0,
  warning_pct NUMERIC(5, 2) NOT NULL DEFAULT 75.0,
  danger_pct NUMERIC(5, 2) NOT NULL DEFAULT 90.0,
  rain_intensity_threshold_mm_hr NUMERIC(6, 2) NOT NULL DEFAULT 35.0,
  alternate_route_en TEXT NOT NULL,
  alternate_route_ta TEXT NOT NULL,
  historical_events JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE sensors (
  id VARCHAR(64) PRIMARY KEY,
  street_id VARCHAR(64) NOT NULL REFERENCES streets(id) ON DELETE CASCADE,
  hardware_type VARCHAR(80) NOT NULL DEFAULT 'ESP32 + JSN-SR04T + TippingBucket',
  lat NUMERIC(9, 6) NOT NULL,
  lng NUMERIC(9, 6) NOT NULL,
  status sensor_status NOT NULL DEFAULT 'online',
  battery_pct NUMERIC(5, 2) NOT NULL DEFAULT 100.0,
  firmware_version VARCHAR(32) NOT NULL DEFAULT '1.4.2',
  last_ping_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE readings (
  id BIGSERIAL PRIMARY KEY,
  street_id VARCHAR(64) NOT NULL REFERENCES streets(id) ON DELETE CASCADE,
  sensor_id VARCHAR(64) NOT NULL REFERENCES sensors(id) ON DELETE CASCADE,
  water_level_cm NUMERIC(6, 2) NOT NULL CHECK (water_level_cm >= 0),
  rainfall_mm_hr NUMERIC(6, 2) NOT NULL CHECK (rainfall_mm_hr >= 0),
  rainfall_1h_mm NUMERIC(6, 2) NOT NULL DEFAULT 0,
  rainfall_3h_mm NUMERIC(6, 2) NOT NULL DEFAULT 0,
  rainfall_24h_mm NUMERIC(6, 2) NOT NULL DEFAULT 0,
  risk_score INTEGER NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  risk_level risk_level NOT NULL,
  eta_danger_minutes INTEGER,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_readings_street_time ON readings(street_id, recorded_at DESC);

CREATE TABLE alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  street_id VARCHAR(64) NOT NULL REFERENCES streets(id) ON DELETE CASCADE,
  level alert_level NOT NULL,
  title_en VARCHAR(160) NOT NULL,
  title_ta VARCHAR(200) NOT NULL,
  message_en TEXT NOT NULL,
  message_ta TEXT NOT NULL,
  channels_dispatched JSONB NOT NULL DEFAULT '["push","sms","email"]',
  is_manual BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  street_id VARCHAR(64) NOT NULL REFERENCES streets(id) ON DELETE CASCADE,
  channels JSONB NOT NULL DEFAULT '["push","sms","email"]',
  radius_meters INTEGER NOT NULL DEFAULT 500,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, street_id)
);

CREATE TABLE reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  street_id VARCHAR(64) REFERENCES streets(id) ON DELETE SET NULL,
  street_name VARCHAR(120) NOT NULL,
  severity report_severity NOT NULL,
  description VARCHAR(400) NOT NULL,
  photo_url TEXT,
  lat NUMERIC(9, 6) NOT NULL,
  lng NUMERIC(9, 6) NOT NULL,
  status report_status NOT NULL DEFAULT 'unverified',
  confirmations INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
