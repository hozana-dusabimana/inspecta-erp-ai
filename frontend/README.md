# INSPECTA BUILDOS — Frontend

React 19 + Vite + Tailwind (Google Stitch design, preserved) wired to the
INSPECTA BUILDOS backend API. There is no AI or data logic in this app anymore —
all real APIs live in `../backend`.

## Run
```bash
cp .env.example .env      # set VITE_API_URL (default http://localhost:4000/api)
npm install
npm run dev               # http://localhost:3000
```
Make sure the backend is running first (see the root `README.md`).

## Key files
- `src/lib/api.ts` — typed API client (bearer auth + transparent token refresh).
- `src/lib/auth.tsx` — `AuthProvider` / `useAuth` (login, register, logout, permissions).
- `src/components/*` — Stitch-designed views, wired to real endpoints.

## Env
| Var | Purpose |
|---|---|
| `VITE_API_URL` | Backend API base URL (default `http://localhost:4000/api`) |
| `PORT` | Frontend host port for `server.ts` (default `3000`) |
