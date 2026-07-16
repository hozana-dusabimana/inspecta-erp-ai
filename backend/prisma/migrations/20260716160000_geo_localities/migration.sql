-- Optional 4th geo level below City (e.g. Rwanda sectors under a district).

CREATE TABLE "localities" (
    "id" TEXT NOT NULL,
    "cityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "latitude" TEXT,
    "longitude" TEXT,

    CONSTRAINT "localities_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "localities_cityId_idx" ON "localities"("cityId");
CREATE INDEX "localities_cityId_name_idx" ON "localities"("cityId", "name");

ALTER TABLE "localities" ADD CONSTRAINT "localities_cityId_fkey" FOREIGN KEY ("cityId") REFERENCES "cities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
