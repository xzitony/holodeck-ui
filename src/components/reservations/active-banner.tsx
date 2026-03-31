"use client";

import { useReservation } from "@/hooks/use-reservation";
import { useEffect, useState } from "react";

function TimeRemaining({ endTime }: { endTime: string }) {
  const [timeLeft, setTimeLeft] = useState("");

  useEffect(() => {
    const update = () => {
      const now = new Date();
      const end = new Date(endTime);
      const diff = end.getTime() - now.getTime();

      if (diff <= 0) {
        setTimeLeft("Expired");
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      setTimeLeft(`${hours}h ${minutes}m remaining`);
    };

    update();
    const interval = setInterval(update, 30000);
    return () => clearInterval(interval);
  }, [endTime]);

  return <span>{timeLeft}</span>;
}

export function ActiveReservationBanner() {
  const { reservation, maintenance, loading } = useReservation();

  if (loading) return null;

  return (
    <>
      {/* Maintenance window banner — visible to everyone */}
      {maintenance && (
        <div className="px-4 py-2 text-sm flex items-center justify-between bg-warning/10 text-warning border-b border-warning/20">
          <span>
            Maintenance window: <strong>{maintenance.title}</strong>
            <span className="opacity-75 ml-2">— {maintenance.user.displayName}</span>
          </span>
          <TimeRemaining endTime={maintenance.endTime} />
        </div>
      )}

      {/* Own reservation banner — for labadmin+ with active reservation */}
      {reservation && (
        <div
          className={`px-4 py-2 text-sm flex items-center justify-between ${
            new Date(reservation.endTime).getTime() - Date.now() < 30 * 60 * 1000
              ? "bg-warning/10 text-warning border-b border-warning/20"
              : "bg-success/10 text-success border-b border-success/20"
          }`}
        >
          <span>
            Active reservation: <strong>{reservation.title}</strong>
          </span>
          <TimeRemaining endTime={reservation.endTime} />
        </div>
      )}
    </>
  );
}
