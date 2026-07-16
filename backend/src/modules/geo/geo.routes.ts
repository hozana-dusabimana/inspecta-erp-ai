import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { asyncHandler, ok } from '../../lib/http';
import { authenticate } from '../../middleware/auth';

const router = Router();
router.use(authenticate);

const searchSchema = z.object({
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const like = (search?: string) =>
  search ? { name: { contains: search, mode: 'insensitive' as const } } : {};

// GET /api/geo/countries?search= — all countries (optionally filtered by name).
router.get(
  '/countries',
  asyncHandler(async (req, res) => {
    const { search } = searchSchema.parse(req.query);
    const countries = await prisma.country.findMany({
      where: like(search),
      orderBy: { name: 'asc' },
      select: { id: true, iso2: true, name: true, emoji: true },
    });
    return ok(res, countries);
  }),
);

// GET /api/geo/countries/:countryId/regions?search= — regions of a country.
router.get(
  '/countries/:countryId/regions',
  asyncHandler(async (req, res) => {
    const { search } = searchSchema.parse(req.query);
    const regions = await prisma.region.findMany({
      where: { countryId: req.params.countryId, ...like(search) },
      orderBy: { name: 'asc' },
      select: { id: true, name: true },
    });
    return ok(res, regions);
  }),
);

// GET /api/geo/regions/:regionId/cities?search=&limit= — cities of a region.
// `hasLocalities` tells the client whether a deeper (4th) level exists, so it can
// show the extra picker (e.g. Rwanda sectors) only when relevant.
router.get(
  '/regions/:regionId/cities',
  asyncHandler(async (req, res) => {
    const { search, limit } = searchSchema.parse(req.query);
    const cities = await prisma.city.findMany({
      where: { regionId: req.params.regionId, ...like(search) },
      orderBy: { name: 'asc' },
      take: limit ?? 50,
      select: { id: true, name: true, _count: { select: { localities: true } } },
    });
    return ok(
      res,
      cities.map((c) => ({ id: c.id, name: c.name, hasLocalities: c._count.localities > 0 })),
    );
  }),
);

// GET /api/geo/cities/:cityId/localities?search=&limit= — 4th level (e.g. sectors).
router.get(
  '/cities/:cityId/localities',
  asyncHandler(async (req, res) => {
    const { search, limit } = searchSchema.parse(req.query);
    const localities = await prisma.locality.findMany({
      where: { cityId: req.params.cityId, ...like(search) },
      orderBy: { name: 'asc' },
      take: limit ?? 100,
      select: { id: true, name: true },
    });
    return ok(res, localities);
  }),
);

export default router;
