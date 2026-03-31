"use client";

import { useEffect, useState } from "react";

interface AuditEntry {
  id: string;
  action: string;
  status: string;
  details?: string;
  createdAt: string;
  ipAddress?: string;
  user: { displayName: string; username: string };
  command?: { name: string; slug: string } | null;
}

const actionLabels: Record<string, string> = {
  login: "Login",
  command_execute: "Command Executed",
  reservation_create: "Reservation Created",
  reservation_cancel: "Reservation Cancelled",
  config_update: "Config Updated",
};

export default function HistoryPage() {
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);

  useEffect(() => {
    fetch(`/api/audit?page=${page}&limit=25`)
      .then((r) => r.json())
      .then((data) => {
        setLogs(data.logs || []);
        setTotalPages(data.pagination?.totalPages || 1);
      });
  }, [page]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Audit History</h1>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground uppercase tracking-wider">
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Details</th>
              <th className="px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id} className="border-b border-border/50">
                <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">
                  {new Date(log.createdAt).toLocaleString()}
                </td>
                <td className="px-4 py-3 text-sm">
                  {log.user.displayName}
                </td>
                <td className="px-4 py-3 text-sm">
                  {actionLabels[log.action] || log.action}
                </td>
                <td className="px-4 py-3 text-sm text-muted-foreground max-w-xs truncate">
                  {log.command?.name || (log.details ? parseDetails(log.details) : "—")}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      log.status === "success"
                        ? "bg-success/20 text-success"
                        : log.status === "failure"
                        ? "bg-warning/20 text-warning"
                        : "bg-destructive/20 text-destructive"
                    }`}
                  >
                    {log.status}
                  </span>
                </td>
              </tr>
            ))}
            {logs.length === 0 && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-8 text-center text-muted-foreground"
                >
                  No audit log entries found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1 bg-card border border-border rounded-md text-sm disabled:opacity-50"
          >
            Previous
          </button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-3 py-1 bg-card border border-border rounded-md text-sm disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

function parseDetails(details: string): string {
  try {
    const parsed = JSON.parse(details);
    if (parsed.command) return parsed.command;
    if (parsed.keys) return `Updated: ${parsed.keys.join(", ")}`;
    if (parsed.reservationId) return `Reservation: ${parsed.title || parsed.reservationId}`;
    return details.slice(0, 100);
  } catch {
    return details.slice(0, 100);
  }
}
