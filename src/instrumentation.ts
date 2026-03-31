/**
 * Next.js instrumentation hook — runs once on server startup.
 * Used to start the reservation reminder polling loop.
 */
export async function register() {
  // Only run on the server, not during build or edge
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const INTERVAL_MS = 60 * 1000; // check every minute

    setInterval(async () => {
      try {
        const port = process.env.PORT || 3000;
        const secret = process.env.CRON_SECRET || "";
        const headers: Record<string, string> = {};
        if (secret) headers["Authorization"] = `Bearer ${secret}`;

        await fetch(`http://localhost:${port}/api/cron/reservation-reminders`, { headers });
      } catch {
        // Silently ignore — server may not be ready yet
      }
    }, INTERVAL_MS);
  }
}
