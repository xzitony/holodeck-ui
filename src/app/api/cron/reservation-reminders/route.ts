import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendReservationReminder } from "@/lib/email";

/**
 * GET /api/cron/reservation-reminders
 *
 * Finds confirmed reservations starting within the next 5 minutes
 * that haven't been reminded yet, sends reminder emails, and marks them.
 *
 * Call this endpoint on a schedule (e.g. every minute via cron or setInterval).
 * Protected by a simple bearer token check using CRON_SECRET env var,
 * or allows unauthenticated access if CRON_SECRET is not set.
 */
export async function GET(request: Request) {
  // Optional auth: if CRON_SECRET is set, require it
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // Check if reminders are enabled
  const reminderConfig = await prisma.globalConfig.findUnique({
    where: { key: "email_reservation_reminders" },
  });
  if (reminderConfig?.value !== "true") {
    return NextResponse.json({ message: "Reminders disabled", sent: 0 });
  }

  const now = new Date();
  const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

  // Find reservations starting within 5 minutes that haven't been reminded
  const upcoming = await prisma.reservation.findMany({
    where: {
      status: "confirmed",
      reminderSent: false,
      startTime: {
        gt: now,
        lte: fiveMinutesFromNow,
      },
    },
    include: {
      user: { select: { email: true, displayName: true } },
    },
  });

  let sent = 0;
  for (const res of upcoming) {
    if (!res.user.email) {
      // No email — still mark as sent so we don't keep retrying
      await prisma.reservation.update({
        where: { id: res.id },
        data: { reminderSent: true },
      });
      continue;
    }

    try {
      await sendReservationReminder({
        title: res.title,
        startTime: res.startTime,
        endTime: res.endTime,
        userEmail: res.user.email,
        userName: res.user.displayName,
      });
      sent++;
    } catch {
      // Log but don't fail the whole batch
      console.error(`[cron] Failed to send reminder for reservation ${res.id}`);
    }

    await prisma.reservation.update({
      where: { id: res.id },
      data: { reminderSent: true },
    });
  }

  return NextResponse.json({ message: "OK", checked: upcoming.length, sent });
}
