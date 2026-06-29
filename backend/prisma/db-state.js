// Decide how to bring up the database on container start.
//
//   "baseline" — the app schema already exists (built previously by `db push`)
//                but Prisma has no migration history. Mark the init migration as
//                applied so `migrate deploy` won't try to recreate tables.
//   "deploy"   — either a fresh database (migrate deploy creates everything from
//                the init migration) or one that already has migration history
//                (migrate deploy just applies any new migrations).
//
// Prints exactly one word to stdout; never throws (defaults to "deploy").
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const q = String.fromCharCode(39); // single quote, avoids shell/JS quote escaping
// Cast to text — Prisma's raw query can't deserialize the `regclass` OID type.
const sql = `SELECT to_regclass(${q}_prisma_migrations${q})::text AS hist, to_regclass(${q}organizations${q})::text AS tbl`;

prisma
  .$queryRawUnsafe(sql)
  .then((rows) => {
    const { hist, tbl } = rows[0] || {};
    // Existing schema, no migration history → baseline. Otherwise normal deploy.
    process.stdout.write(!hist && tbl ? 'baseline' : 'deploy');
  })
  .catch(() => process.stdout.write('deploy'))
  .finally(() => prisma.$disconnect());
