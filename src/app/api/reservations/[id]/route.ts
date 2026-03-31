import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";
import { sendReservationCancellation } from "@/lib/email";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const reservation = await prisma.reservation.findUnique({ where: { id } });
  if (!reservation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Only owner or super admin can cancel
  if (reservation.userId !== user.userId && user.role !== "superadmin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await prisma.reservation.update({
    where: { id },
    data: { status: "cancelled" },
  });

  await prisma.auditLog.create({
    data: {
      userId: user.userId,
      action: "reservation_cancel",
      details: JSON.stringify({ reservationId: id }),
      status: "success",
    },
  });

  // Notify the reservation owner (fire-and-forget)
  const owner = await prisma.user.findUnique({
    where: { id: reservation.userId },
    select: { email: true, username: true },
  });
  if (owner?.email) {
    sendReservationCancellation({
      title: reservation.title,
      startTime: reservation.startTime,
      endTime: reservation.endTime,
      userEmail: owner.email,
      cancelledBy: user.username,
    }).catch(() => {});
  }

  return NextResponse.json({ success: true });
}
