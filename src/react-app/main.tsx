import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "sonner";
import App from "./App";
import { ContextMenuHost } from "./components/ContextMenu";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: true },
  },
});

// A pinch anywhere is never the browser's to act on: the page surfaces take
// it (usePinchZoom) and everywhere else it does nothing, rather than scaling
// the header off the screen. iOS ignores `user-scalable=no` in the browser
// and only honours a cancelled two-finger move and its own gesture events.
document.addEventListener("touchmove", (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <Toaster position="top-center" richColors closeButton />
        <ContextMenuHost />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
