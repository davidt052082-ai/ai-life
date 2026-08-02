ALTER TABLE analytics_events ADD COLUMN city_name text;

CREATE INDEX analytics_events_city_date_idx
  ON analytics_events (city_name, event_date DESC)
  WHERE city_name IS NOT NULL;
