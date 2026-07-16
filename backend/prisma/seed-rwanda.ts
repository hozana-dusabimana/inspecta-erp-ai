/**
 * Replaces Rwanda's (sparse) ISO-dataset regions/cities with the full official
 * administrative hierarchy — Province → District → Sector — mapped onto the geo
 * tables as Region (province) → City (district) → Locality (sector).
 *
 * Idempotent: it deletes Rwanda's existing regions (cascading their cities +
 * localities) and rebuilds from prisma/data/rwanda-locations.json, so it can be
 * re-run safely. Project.location is a plain string, so nothing references these
 * rows by id — the rebuild is safe.
 *
 *   npm run seed:rwanda
 *   docker exec inspecta-prod-backend npx tsx prisma/seed-rwanda.ts   (on the server)
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface ProvinceData {
  province: string;
  code: string | null;
  districts: { name: string; sectors: string[] }[];
}

async function main() {
  const data: ProvinceData[] = JSON.parse(
    readFileSync(join(__dirname, 'data', 'rwanda-locations.json'), 'utf8'),
  );

  const country = await prisma.country.findUnique({ where: { iso2: 'RW' } });
  if (!country) {
    throw new Error('Rwanda (iso2=RW) not found — run `npm run seed:geo` first.');
  }

  // Reset Rwanda's subtree (cascade removes its cities + localities).
  const del = await prisma.region.deleteMany({ where: { countryId: country.id } });
  console.log(`🇷🇼 Cleared ${del.count} existing Rwanda regions.`);

  let districts = 0;
  let sectors = 0;

  for (const p of data) {
    const province = await prisma.region.create({
      data: { countryId: country.id, name: p.province, stateCode: p.code },
    });

    for (const d of p.districts) {
      const district = await prisma.city.create({
        data: { regionId: province.id, name: d.name },
      });
      districts++;

      if (d.sectors.length) {
        await prisma.locality.createMany({
          data: d.sectors.map((name) => ({ cityId: district.id, name })),
        });
        sectors += d.sectors.length;
      }
    }
  }

  console.log(`✅ Rwanda seeded: ${data.length} provinces, ${districts} districts, ${sectors} sectors.`);
}

main()
  .catch((e) => {
    console.error('Rwanda seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
