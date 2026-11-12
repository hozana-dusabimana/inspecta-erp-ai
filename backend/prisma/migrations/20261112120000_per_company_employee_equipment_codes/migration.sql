-- EMP-#### and EQ-#### are generated per company, so they must be unique per company, not across all companies.
DROP INDEX IF EXISTS "employees_employeeNo_key";
DROP INDEX IF EXISTS "equipment_code_key";
CREATE UNIQUE INDEX "employees_organizationId_employeeNo_key" ON "employees"("organizationId", "employeeNo");
CREATE UNIQUE INDEX "equipment_organizationId_code_key" ON "equipment"("organizationId", "code");
