import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';

dotenv.config();

// Frontend host. The app talks to the INSPECTA BUILDOS backend (default
// http://localhost:4000/api) configured via VITE_API_URL — there is no AI or
// data proxy here anymore; all real APIs live in the backend service.
const PORT = Number(process.env.PORT ?? 3000);

async function startServer() {
  const app = express();

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    console.log('Vite development middleware mounted.');
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
    console.log('Serving production static assets from:', distPath);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Inspecta BuildOS frontend running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start frontend server:', err);
});
