import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";
import { createReservationSchema } from "@/lib/validators";
import { sendReservationConfirmation } from "@/lib/email";

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const where: Record<string, unknown> = { status: "confirmed" };
  if (from) where.endTime = { gte: new Date(from) };
  if (to) where.startTime = { lte: new Date(to) };

  const reservations = await prisma.reservation.findMany({
    where,
    include: {
      user: { select: { displayName: true, username: true, email: true } },
    },
    orderBy: { startTime: "asc" },
  });

  return NextResponse.json({ reservations });
}

export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = createReservationSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const startTime = new Date(parsed.data.startTime);
  const endTime = new Date(parsed.data.endTime);

  // Check it's in the future
  if (startTime < new Date()) {
    return NextResponse.json(
      { error: "Cannot create reservations in the past" },
      { status: 400 }
    );
  }

  // Only labadmin+ can create maintenance windows
  const isMaintenance = parsed.data.isMaintenance && user.role !== "user";
  const isCustomerDemo = parsed.data.isCustomerDemo || false;

  // Check for overlaps
  const overlapping = await prisma.reservation.findMany({
    where: {
      status: "confirmed",
      startTime: { lt: endTime },
      endTime: { gt: startTime },
    },
    include: {
      user: { select: { displayName: true, username: true, email: true, role: true } },
    },
  });

  if (overlapping.length > 0 && !body.confirmOverlap) {
    const conflicts = overlapping.map((r) => ({
      id: r.id,
      title: r.title,
      startTime: r.startTime,
      endTime: r.endTime,
      isCustomerDemo: r.isCustomerDemo,
      isMaintenance: r.isMaintenance,
      user: {
        displayName: r.user.displayName,
        username: r.user.username,
        email: r.user.email,
      },
    }));

    const hasCustomerDemo = overlapping.some((r) => r.isCustomerDemo);
    const hasMaintenance = overlapping.some((r) => r.isMaintenance);

    let message: string;
    if (isMaintenance && hasCustomerDemo) {
      message = "This maintenance window overlaps with a CUSTOMER DEMO. This could be very disruptive. Please coordinate with the user before proceeding.";
    } else if (isMaintenance) {
      message = "This maintenance window overlaps with existing reservations. The affected users will see a maintenance banner.";
    } else if (hasMaintenance) {
      message = "This time slot overlaps with a scheduled maintenance window. The environment may be unavailable during that time.";
    } else {
      message = "This time slot overlaps with an existing reservation. You can still book, but be aware the environment will be shared.";
    }

    return NextResponse.json(
      {
        error: "overlap_warning",
        conflicts,
        hasCustomerDemo,
        hasMaintenance,
        message,
      },
      { status: 409 }
    );
  }

  const reservation = await prisma.reservation.create({
    data: {
      userId: user.userId,
      title: parsed.data.title,
      startTime,
      endTime,
      notes: parsed.data.notes,
      isMaintenance: isMaintenance || false,
      isCustomerDemo,
    },
    include: {
      user: { select: { displayName: true } },
    },
  });

  await prisma.auditLog.create({
    data: {
      userId: user.userId,
      action: "reservation_create",
      details: JSON.stringify({
        reservationId: reservation.id,
        title: reservation.title,
        startTime: reservation.startTime,
        endTime: reservation.endTime,
        isMaintenance: isMaintenance || false,
        isCustomerDemo,
        overlappedReservations: overlapping.map((r) => r.id),
      }),
      status: "success",
    },
  });

  // Send confirmation email to the user (fire-and-forget)
  const dbUser = await prisma.user.findUnique({
    where: { id: user.userId },
    select: { email: true, displayName: true },
  });
  if (dbUser?.email) {
    sendReservationConfirmation({
      title: reservation.title,
      startTime,
      endTime,
      userEmail: dbUser.email,
      userName: dbUser.displayName,
    }).catch(() => {});
  }

  return NextResponse.json({ reservation }, { status: 201 });
}
