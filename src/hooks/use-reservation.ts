"use client";

import { useCallback, useEffect, useState } from "react";

interface ActiveReservation {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
}

interface MaintenanceWindow {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  user: { displayName: string };
}

export function useReservation() {
  const [reservation, setReservation] = useState<ActiveReservation | null>(null);
  const [maintenance, setMaintenance] = useState<MaintenanceWindow | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchActive = useCallback(async () => {
    try {
      const res = await fetch("/api/reservations/active");
      if (res.ok) {
        const data = await res.json();
        setReservation(data.reservation);
        setMaintenance(data.maintenance);
      } else {
        setReservation(null);
        setMaintenance(null);
      }
    } catch {
      setReservation(null);
      setMaintenance(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchActive();
    const interval = setInterval(fetchActive, 60000);
    return () => clearInterval(interval);
  }, [fetchActive]);

  return { reservation, maintenance, loading, refresh: fetchActive };
}
