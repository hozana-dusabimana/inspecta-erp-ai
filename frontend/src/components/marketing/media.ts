// ─────────────────────────────────────────────────────────────
// Marketing site images — EDIT HERE to swap in your own photos.
// Replace each URL with your own image (upload it to /public and use e.g.
// '/photos/my-lab.jpg', or paste any image URL). These are verified free
// commercial-use stock photos from Unsplash, used as placeholders until the
// real Inspecta site/lab/team photos are available.
// ─────────────────────────────────────────────────────────────
const u = (id: string, w = 1600) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=70`;

export const MEDIA = {
  // Home — wide construction site with engineers on a slab.
  heroImage: u('1541888946425-d81bb19240f5'),
  // Materials Testing Laboratory — technicians at lab equipment.
  materialsImage: u('1581092160607-ee22621dd758'),
  // Structural Design — engineer drawing on blueprints.
  structuralImage: u('1503387762-592deb58ef4e'),
  // Project Management — workers with rebar/steel on site.
  projectImage: u('1504307651254-35680f356dfd'),
  // About — modern office / premises interior.
  aboutImage: u('1497366216548-37526070297c'),
  // Inspecta ERP — team using software together.
  erpImage: u('1600880292203-757bb62b4baf'),
};

export type MediaKey = keyof typeof MEDIA;
