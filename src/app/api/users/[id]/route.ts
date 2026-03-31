import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserFromRequest, hashPassword } from "@/lib/auth";
import { updateUserSchema } from "@/lib/validators";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUserFromRequest(request);
  if (!user || user.role !== "superadmin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json();
  const parsed = updateUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.displayName) data.displayName = parsed.data.displayName;
  if (parsed.data.email !== undefined) data.email = parsed.data.email || null;
  if (parsed.data.role) data.role = parsed.data.role;
  if (parsed.data.enabled !== undefined) data.enabled = parsed.data.enabled;
  if (parsed.data.password) data.passwordHash = await hashPassword(parsed.data.password);

  const updated = await prisma.user.update({
    where: { id },
    data,
    select: {
      id: true,
      username: true,
      email: true,
      displayName: true,
      role: true,
      enabled: true,
    },
  });

  return NextResponse.json({ user: updated });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getUserFromRequest(request);
  if (!user || user.role !== "superadmin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  // Soft disable, don't delete
  await prisma.user.update({
    where: { id },
    data: { enabled: false },
  });

  return NextResponse.json({ success: true });
}
