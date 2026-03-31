"use client";

import { useAuth } from "@/hooks/use-auth";
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
  userId: string;
  user: { displayName: string; username: string; email?: string };
}

interface ConflictInfo {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  isCustomerDemo: boolean;
  isMaintenance: boolean;
  user: { displayName: string; username: string; email?: string };
}

export default function ReservationsPage() {
  const { user } = useAuth();
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startTimeOfDay, setStartTimeOfDay] = useState("09:00");
  const [endDate, setEndDate] = useState("");
  const [endTimeOfDay, setEndTimeOfDay] = useState("10:00");
  const [notes, setNotes] = useState("");
  const [isMaintenance, setIsMaintenance] = useState(false);
  const [isCustomerDemo, setIsCustomerDemo] = useState(false);
  const [error, setError] = useState("");
  const [conflicts, setConflicts] = useState<ConflictInfo[] | null>(null);
  const [hasCustomerDemoConflict, setHasCustomerDemoConflict] = useState(false);
  const [hasMaintenanceConflict, setHasMaintenanceConflict] = useState(false);
  const [overlapMessage, setOverlapMessage] = useState("");
  const [viewWeek, setViewWeek] = useState(() => {
    const now = new Date();
    now.setDate(now.getDate() - now.getDay());
    return now.toISOString().split("T")[0];
  });

  const fetchReservations = async () => {
    const from = new Date(viewWeek);
    const to = new Date(from);
    to.setDate(to.getDate() + 30);
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
  }, [viewWeek]); // eslint-disable-line react-hooks/exhaustive-deps

  // Generate time options in 30-minute increments
  const timeOptions = Array.from({ length: 48 }, (_, i) => {
    const h = Math.floor(i / 2);
    const m = i % 2 === 0 ? "00" : "30";
    const value = `${h.toString().padStart(2, "0")}:${m}`;
    const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    const ampm = h < 12 ? "AM" : "PM";
    const label = `${hour12}:${m} ${ampm}`;
    return { value, label };
  });

  const combineDateTime = (date: string, time: string) => {
    if (!date || !time) return "";
    return new Date(`${date}T${time}`).toISOString();
  };

  const submitReservation = async (confirmOverlap = false) => {
    setError("");

    if (!startDate || !endDate) {
      setError("Please select both start and end dates");
      return;
    }

    const res = await fetch("/api/reservations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        startTime: combineDateTime(startDate, startTimeOfDay),
        endTime: combineDateTime(endDate, endTimeOfDay),
        notes: notes || undefined,
        isMaintenance: isMaintenance || undefined,
        isCustomerDemo: isCustomerDemo || undefined,
        confirmOverlap,
      }),
    });

    if (!res.ok) {
      const data = await res.json();

      // Handle overlap warning
      if (data.error === "overlap_warning") {
        setConflicts(data.conflicts);
        setHasCustomerDemoConflict(data.hasCustomerDemo);
        setHasMaintenanceConflict(data.hasMaintenance || false);
        setOverlapMessage(data.message);
        return;
      }

      setError(data.error || "Failed to create reservation");
      return;
    }

    resetForm();
    fetchReservations();
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setConflicts(null);
    await submitReservation(false);
  };

  const handleConfirmOverlap = async () => {
    setConflicts(null);
    await submitReservation(true);
  };

  const resetForm = () => {
    setShowForm(false);
    setTitle("");
    setStartDate("");
    setStartTimeOfDay("09:00");
    setEndDate("");
    setEndTimeOfDay("10:00");
    setNotes("");
    setIsMaintenance(false);
    setIsCustomerDemo(false);
    setConflicts(null);
    setHasCustomerDemoConflict(false);
    setHasMaintenanceConflict(false);
    setOverlapMessage("");
    setError("");
  };

  const handleCancel = async (id: string) => {
    if (!confirm("Cancel this reservation?")) return;
    await fetch(`/api/reservations/${id}`, { method: "DELETE" });
    fetchReservations();
  };

  const formatDate = (d: string) =>
    new Date(d).toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });

  const now = new Date();
  const isLabAdminOrAbove = user?.role === "labadmin" || user?.role === "superadmin";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Reservations</h1>
        <button
          onClick={() => {
            if (showForm) resetForm();
            else setShowForm(true);
          }}
          className="px-4 py-2 bg-primary text-primary-foreground rounded-md font-medium hover:opacity-90"
        >
          {showForm ? "Cancel" : "New Reservation"}
        </button>
      </div>

      {showForm && (
        <form
          onSubmit={handleCreate}
          className="bg-card border border-border rounded-lg p-4 space-y-4"
        >
          <h2 className="font-semibold">Book a Time Slot</h2>
          {error && (
            <div className="p-3 bg-destructive/10 text-destructive rounded-md text-sm">
              {error}
            </div>
          )}

          {/* Overlap warning dialog */}
          {conflicts && (
            <div
              className={`p-4 rounded-md border text-sm space-y-3 ${
                hasCustomerDemoConflict
                  ? "bg-destructive/10 border-destructive/30 text-destructive"
                  : hasMaintenanceConflict
                  ? "bg-warning/10 border-warning/30 text-warning"
                  : "bg-primary/10 border-primary/30 text-primary"
              }`}
            >
              <p className="font-semibold">
                {hasCustomerDemoConflict
                  ? "Warning: Customer Demo Conflict!"
                  : hasMaintenanceConflict
                  ? "Heads up: Maintenance Window Scheduled"
                  : "Overlapping Reservation"}
              </p>
              <div className="space-y-2">
                {conflicts.map((c) => (
                  <div
                    key={c.id}
                    className={`p-3 rounded-md border ${
                      c.isCustomerDemo
                        ? "bg-destructive/10 border-destructive/40"
                        : c.isMaintenance
                        ? "bg-warning/10 border-warning/40"
                        : "bg-background/50 border-border"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-foreground">{c.title}</span>
                      {c.isCustomerDemo && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-destructive/20 text-destructive font-semibold">
                          Customer Demo
                        </span>
                      )}
                      {c.isMaintenance && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-warning/20 text-warning font-semibold">
                          Maintenance
                        </span>
                      )}
                    </div>
                    <p className="text-muted-foreground text-xs mt-1">
                      {formatDate(c.startTime)} — {formatDate(c.endTime)}
                    </p>
                    <p className="text-foreground text-xs mt-1">
                      Reserved by: {c.user.displayName} ({c.user.username})
                      {c.user.email && (
                        <>
                          {" — "}
                          <a
                            href={`mailto:${c.user.email}`}
                            className="text-primary hover:underline"
                          >
                            {c.user.email}
                          </a>
                        </>
                      )}
                    </p>
                  </div>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {overlapMessage}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleConfirmOverlap}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium ${
                    hasCustomerDemoConflict
                      ? "bg-destructive text-destructive-foreground hover:opacity-90"
                      : hasMaintenanceConflict
                      ? "bg-warning text-black hover:opacity-90"
                      : "bg-primary text-primary-foreground hover:opacity-90"
                  }`}
                >
                  {hasCustomerDemoConflict
                    ? "Proceed Anyway (Not Recommended)"
                    : "I Understand, Book Anyway"}
                </button>
                <button
                  type="button"
                  onClick={() => setConflicts(null)}
                  className="px-3 py-1.5 rounded-md text-xs font-medium bg-muted text-muted-foreground hover:bg-muted/80"
                >
                  Go Back
                </button>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Lab testing for Project X"
              className="w-full px-3 py-2 bg-input border border-border rounded-md"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">
                Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  if (e.target.value && !endDate) {
                    setEndDate(e.target.value);
                  }
                }}
                className="w-full px-3 py-2 bg-input border border-border rounded-md"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                Start Time
              </label>
              <select
                value={startTimeOfDay}
                onChange={(e) => {
                  setStartTimeOfDay(e.target.value);
                  // Auto-advance end time to 1 hour later
                  const [h, m] = e.target.value.split(":").map(Number);
                  const endMinutes = h * 60 + m + 60;
                  const endH = Math.floor(endMinutes / 60) % 24;
                  const endM = endMinutes % 60;
                  setEndTimeOfDay(
                    `${endH.toString().padStart(2, "0")}:${endM === 0 ? "00" : "30"}`
                  );
                }}
                className="w-full px-3 py-2 bg-input border border-border rounded-md"
              >
                {timeOptions.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                End Date
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                min={startDate}
                className="w-full px-3 py-2 bg-input border border-border rounded-md"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">
                End Time
              </label>
              <select
                value={endTimeOfDay}
                onChange={(e) => setEndTimeOfDay(e.target.value)}
                className="w-full px-3 py-2 bg-input border border-border rounded-md"
              >
                {timeOptions.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">
              Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3 py-2 bg-input border border-border rounded-md"
              rows={2}
            />
          </div>

          {/* Role-specific options */}
          <div className="space-y-2">
            {isLabAdminOrAbove && (
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={isMaintenance}
                  onChange={(e) => {
                    setIsMaintenance(e.target.checked);
                    if (e.target.checked) setIsCustomerDemo(false);
                  }}
                  className="w-4 h-4"
                />
                <span className="font-medium">Maintenance Window</span>
                <span className="text-muted-foreground">
                  — Users will see a banner during this time
                </span>
              </label>
            )}
            {!isMaintenance && (
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={isCustomerDemo}
                  onChange={(e) => setIsCustomerDemo(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="font-medium">Customer Demo</span>
                <span className="text-muted-foreground">
                  — Lab admins will see a stronger warning before scheduling maintenance
                </span>
              </label>
            )}
          </div>

          <button
            type="submit"
            className="px-4 py-2 bg-primary text-primary-foreground rounded-md font-medium hover:opacity-90"
          >
            Book Reservation
          </button>
        </form>
      )}

      {/* Reservation list */}
      <div className="space-y-3">
        {reservations.length === 0 ? (
          <div className="bg-card border border-border rounded-lg p-8 text-center text-muted-foreground">
            No reservations found for this period
          </div>
        ) : (
          reservations.map((r) => {
            const start = new Date(r.startTime);
            const end = new Date(r.endTime);
            const isActive = start <= now && end >= now;
            const isPast = end < now;
            const isMine = r.userId === user?.id;

            return (
              <div
                key={r.id}
                className={`bg-card border rounded-lg p-4 flex items-center justify-between ${
                  isActive
                    ? "border-success/50"
                    : isPast
                    ? "border-border opacity-60"
                    : "border-border"
                }`}
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{r.title}</span>
                    {isActive && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-success/20 text-success">
                        Active Now
                      </span>
                    )}
                    {r.isMaintenance && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-warning/20 text-warning">
                        Maintenance
                      </span>
                    )}
                    {r.isCustomerDemo && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-destructive/20 text-destructive">
                        Customer Demo
                      </span>
                    )}
                    {isMine && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-primary/20 text-primary">
                        Yours
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">
                    {formatDate(r.startTime)} — {formatDate(r.endTime)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Booked by {r.user.displayName}
                    {r.user.email && (
                      <span className="ml-1">({r.user.email})</span>
                    )}
                  </div>
                  {r.notes && (
                    <div className="text-xs text-muted-foreground mt-1">
                      {r.notes}
                    </div>
                  )}
                </div>
                {(isMine || user?.role === "superadmin") && !isPast && (
                  <button
                    onClick={() => handleCancel(r.id)}
                    className="text-sm text-destructive hover:underline"
                  >
                    Cancel
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
