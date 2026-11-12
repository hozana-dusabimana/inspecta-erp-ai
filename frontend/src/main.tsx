import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient, QueryClientProvider, MutationCache} from '@tanstack/react-query';
import {Toaster} from './components/Toaster';
import {CurrentProjectProvider} from './lib/currentProject';
import {toast} from './lib/toast';
import {errorMessage, ApiError} from './lib/api';
import {BrowserRouter} from 'react-router-dom';
import App from './App.tsx';
import {AuthProvider} from './lib/auth';
import {ThemeProvider} from './lib/theme';
import './index.css';

const queryClient: QueryClient = new QueryClient({
  // Every successful save refreshes everything on screen (finance cards, approvals, stock...),
  // and a refused action always shows the server's rule message instead of failing silently.
  mutationCache: new MutationCache({
    onSuccess: () => { void queryClient.invalidateQueries(); },
    onError: (error, _vars, _ctx, mutation) => {
      if (mutation.options.onError) return; // the caller shows its own message
      if (error instanceof ApiError && error.status === 401) return; // handled by the session-expired flow
      toast(errorMessage(error), 'error');
    },
  }),
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <CurrentProjectProvider>
            <BrowserRouter>
              <App />
              <Toaster />
            </BrowserRouter>
          </CurrentProjectProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);

// Register the PWA service worker (Module 19) in production builds.
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* offline shell unavailable — app still works online */
    });
  });
}
