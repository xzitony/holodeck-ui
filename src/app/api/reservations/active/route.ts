import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { getActiveReservation, getActiveMaintenanceWindow } from "@/lib/reservation-guard";

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [reservation, maintenance] = await Promise.all([
    getActiveReservation(user.userId),
    getActiveMaintenanceWindow(),
  ]);

  return NextResponse.json({ reservation, maintenance });
}
