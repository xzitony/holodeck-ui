"use client";

import { useEffect, useState } from "react";

interface Reservation {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  notes?: string;
  isMaintenance: boolean;
  isCustomerDemo: boolean;
  status: string;
  user: { displayName: string; username: string; email?: string };
}

export default function AdminReservationsPage() {
  const [reservations, setReservations] = useState<Reservation[]>([]);

  const fetchReservations = async () => {
    const from = new Date();
    from.setDate(from.getDate() - 7);
    const to = new Date();
    to.setDate(to.getDate() + 60);
    const res = await fetch(
      `/api/reservations?from=${from.toISOString()}&to=${to.toISOString()}`
    );
    if (res.ok) {
      const data = await res.json();
      setReservations(data.reservations || []);
    }
  };

  useEffect(() => {
    fetchReservations();
  }, []);

  const handleCancel = async (id: string) => {
    if (!confirm("Cancel this reservation?")) return;
    await fetch(`/api/reservations/${id}`, { method: "DELETE" });
    fetchReservations();
  };

  const now = new Date();

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Manage Reservations</h1>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase tracking-wider">
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Start</th>
              <th className="px-4 py-3">End</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {reservations.map((r) => {
              const start = new Date(r.startTime);
              const end = new Date(r.endTime);
              const isActive = start <= now && end >= now;

              return (
                <tr key={r.id} className="border-b border-border/50">
                  <td className="px-4 py-3 text-sm">
                    {r.title}
                    {r.isMaintenance && (
                      <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-warning/20 text-warning">
                        Maintenance
                      </span>
                    )}
                    {r.isCustomerDemo && (
                      <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-destructive/20 text-destructive">
                        Customer Demo
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {r.user.displayName}
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {start.toLocaleString(undefined, { timeZoneName: "short" })}
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {end.toLocaleString(undefined, { timeZoneName: "short" })}
                  </td>
                  <td className="px-4 py-3">
                    {isActive ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-success/20 text-success">
                        Active
                      </span>
                    ) : end < now ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                        Past
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary">
                        Upcoming
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {end >= now && (
                      <button
                        onClick={() => handleCancel(r.id)}
                        className="text-destructive hover:underline"
                      >
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
