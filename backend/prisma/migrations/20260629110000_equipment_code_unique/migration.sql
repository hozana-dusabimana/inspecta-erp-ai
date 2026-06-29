-- Equipment: enforce unique code (Module 06 spec: equipment_code UNIQUE).
-- NULL codes remain allowed (Postgres treats NULLs as distinct).
CREATE UNIQUE INDEX "equipment_code_key" ON "equipment"("code");
