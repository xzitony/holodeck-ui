import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { sendTestEmail } from "@/lib/email";

export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user || user.role !== "superadmin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { to } = await request.json();
  if (!to || typeof to !== "string") {
    return NextResponse.json({ error: "Email address required" }, { status: 400 });
  }

  const result = await sendTestEmail(to);
  return NextResponse.json(result);
}
