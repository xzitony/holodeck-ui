import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { testDepotConnection } from "@/lib/ssh";

export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user || user.role !== "superadmin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const result = await testDepotConnection();
  return NextResponse.json(result);
}
