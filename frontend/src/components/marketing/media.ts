// ─────────────────────────────────────────────────────────────
// Marketing site images — EDIT HERE to swap in your own photos.
// Replace each path with your own image (drop it in /public/photos and
// reference it as '/photos/my-lab.jpg', or paste any image URL).
// ─────────────────────────────────────────────────────────────
const u = (id: string, w = 1600) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=${w}&q=70`;

export const MEDIA = {
  // Home — wide site view, Rwanda road/bridge works with survey crew.
  heroImage: '/photos/site-survey-hero.jpg',
  // Materials Testing Laboratory — real Inspecta lab equipment and glassware.
  materialsImage: '/photos/materials-lab.jpg',
  // Structural Design — real structural analysis / FEA model render.
  structuralImage: '/photos/structural-analysis.jpg',
  // Project Management — real site crew tying rebar on scaffolding.
  projectImage: '/photos/rebar-workers.jpg',
  // About — modern office / premises interior (placeholder until a real photo is available).
  aboutImage: u('1497366216548-37526070297c'),
  // Inspecta ERP — real product screenshot (Executive Overview dashboard).
  erpImage: '/photos/erp-dashboard.jpg',
};

export type MediaKey = keyof typeof MEDIA;
