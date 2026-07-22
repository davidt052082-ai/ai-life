ALTER TABLE wearable_equipment DROP CONSTRAINT wearable_equipment_pkey;
ALTER TABLE wearable_equipment ADD PRIMARY KEY (id, user_id, project_id);

ALTER TABLE wearable_schemes DROP CONSTRAINT wearable_schemes_pkey;
ALTER TABLE wearable_schemes ADD PRIMARY KEY (id, user_id, project_id);
