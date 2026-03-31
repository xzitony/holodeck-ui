import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  const payload = await getUserFromRequest(request);
  if (!payload) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: {
      id: true,
      username: true,
      displayName: true,
      email: true,
      role: true,
      enabled: true,
    },
  });

  if (!user || !user.enabled) {
    return NextResponse.json({ error: "User not found or disabled" }, { status: 401 });
  }

  return NextResponse.json({ user });
}
