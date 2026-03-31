import { prisma } from "./db";
import type { UserRole } from "./auth";

export async function hasActiveReservation(userId: string): Promise<boolean> {
  const now = new Date();
  const count = await prisma.reservation.count({
    where: {
      userId,
      status: "confirmed",
      startTime: { lte: now },
      endTime: { gte: now },
    },
  });
  return count > 0;
}

export async function getActiveReservation(userId: string) {
  const now = new Date();
  return prisma.reservation.findFirst({
    where: {
      userId,
      status: "confirmed",
      startTime: { lte: now },
      endTime: { gte: now },
    },
    include: { user: { select: { displayName: true } } },
  });
}

/**
 * Returns any active maintenance window reservation (from any labadmin/superadmin).
 */
export async function getActiveMaintenanceWindow() {
  const now = new Date();
  return prisma.reservation.findFirst({
    where: {
      isMaintenance: true,
      status: "confirmed",
      startTime: { lte: now },
      endTime: { gte: now },
    },
    include: { user: { select: { displayName: true } } },
  });
}

/**
 * Check if a user can deploy.
 * - Superadmins: always allowed
 * - Lab admins: need an active reservation
 * - Users: never allowed (blocked at route/nav level)
 */
export async function checkReservationAccess(
  userId: string,
  role: UserRole
): Promise<{ allowed: boolean; message?: string }> {
  if (role === "superadmin") {
    return { allowed: true };
  }

  if (role === "labadmin") {
    const active = await hasActiveReservation(userId);
    if (!active) {
      return {
        allowed: false,
        message:
          "No active reservation. Lab admins need an active reservation to deploy.",
      };
    }
    return { allowed: true };
  }

  return {
    allowed: false,
    message: "Insufficient permissions.",
  };
}
