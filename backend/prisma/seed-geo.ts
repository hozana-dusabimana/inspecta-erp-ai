/**
 * One-time geographic reference seed: Country → Region (state/province) → City,
 * sourced from the offline `country-state-city` ISO dataset (~250 countries,
 * ~5k regions, ~150k cities).
 *
 * Intentionally NOT part of the startup seed (prisma/seed.ts): it is heavy and
 * only needs to run once. Idempotent — exits early if countries already exist.
 *
 *   npm run seed:geo            (locally, against DATABASE_URL)
 *   docker exec inspecta-prod-backend npx tsx prisma/seed-geo.ts   (on the server)
 */
import { PrismaClient } from '@prisma/client';
import { Country, State, City } from 'country-state-city';

const prisma = new PrismaClient();

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function main() {
  const existing = await prisma.country.count();
  if (existing > 0) {
    console.log(`🌍 Geo data already present (${existing} countries) — skipping.`);
    return;
  }

  const countries = Country.getAllCountries();
  console.log(`🌍 Seeding ${countries.length} countries...`);

  await prisma.country.createMany({
    data: countries.map((c) => ({
      iso2: c.isoCode,
      name: c.name,
      phoneCode: c.phonecode || null,
      currency: c.currency || null,
      emoji: c.flag || null,
      latitude: c.latitude || null,
      longitude: c.longitude || null,
    })),
  });

  const countryRows = await prisma.country.findMany({ select: { id: true, iso2: true } });
  const countryIdByIso = new Map(countryRows.map((r) => [r.iso2, r.id]));

  let totalRegions = 0;
  let totalCities = 0;

  for (const country of countries) {
    const countryId = countryIdByIso.get(country.isoCode);
    if (!countryId) continue;

    const states = State.getStatesOfCountry(country.isoCode);
    if (states.length === 0) continue;

    await prisma.region.createMany({
      data: states.map((s) => ({
        countryId,
        stateCode: s.isoCode || null,
        name: s.name,
        latitude: s.latitude || null,
        longitude: s.longitude || null,
      })),
    });
    totalRegions += states.length;

    // Map this country's freshly-inserted regions back to their state code so we
    // can attach cities. Key by stateCode, falling back to name.
    const regionRows = await prisma.region.findMany({
      where: { countryId },
      select: { id: true, stateCode: true, name: true },
    });
    const regionIdByKey = new Map<string, string>();
    for (const r of regionRows) {
      if (r.stateCode) regionIdByKey.set(`c:${r.stateCode}`, r.id);
      regionIdByKey.set(`n:${r.name}`, r.id);
    }

    const cityData: { regionId: string; name: string; latitude: string | null; longitude: string | null }[] = [];
    for (const s of states) {
      const regionId = regionIdByKey.get(`c:${s.isoCode}`) ?? regionIdByKey.get(`n:${s.name}`);
      if (!regionId) continue;
      const cities = City.getCitiesOfState(country.isoCode, s.isoCode);
      for (const ct of cities) {
        cityData.push({ regionId, name: ct.name, latitude: ct.latitude || null, longitude: ct.longitude || null });
      }
    }

    for (const batch of chunk(cityData, 5000)) {
      await prisma.city.createMany({ data: batch });
    }
    totalCities += cityData.length;
    if (cityData.length) console.log(`  ${country.flag ?? ''} ${country.name}: ${states.length} regions, ${cityData.length} cities`);
  }

  console.log(`✅ Geo seed complete: ${countries.length} countries, ${totalRegions} regions, ${totalCities} cities.`);
}

main()
  .catch((e) => {
    console.error('Geo seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
