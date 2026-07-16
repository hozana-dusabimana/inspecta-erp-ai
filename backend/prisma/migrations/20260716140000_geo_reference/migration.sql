-- Global geographic reference data (Country -> Region -> City) for the
-- project-setup location picker. Not org-scoped. Seeded via `npm run seed:geo`.

CREATE TABLE "countries" (
    "id" TEXT NOT NULL,
    "iso2" TEXT NOT NULL,
    "iso3" TEXT,
    "name" TEXT NOT NULL,
    "phoneCode" TEXT,
    "currency" TEXT,
    "emoji" TEXT,
    "latitude" TEXT,
    "longitude" TEXT,

    CONSTRAINT "countries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "countries_iso2_key" ON "countries"("iso2");
CREATE INDEX "countries_name_idx" ON "countries"("name");

CREATE TABLE "regions" (
    "id" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "stateCode" TEXT,
    "name" TEXT NOT NULL,
    "latitude" TEXT,
    "longitude" TEXT,

    CONSTRAINT "regions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "regions_countryId_idx" ON "regions"("countryId");
CREATE INDEX "regions_countryId_name_idx" ON "regions"("countryId", "name");

CREATE TABLE "cities" (
    "id" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "latitude" TEXT,
    "longitude" TEXT,

    CONSTRAINT "cities_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cities_regionId_idx" ON "cities"("regionId");
CREATE INDEX "cities_regionId_name_idx" ON "cities"("regionId", "name");

ALTER TABLE "regions" ADD CONSTRAINT "regions_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "countries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cities" ADD CONSTRAINT "cities_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "regions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
