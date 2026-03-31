import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserFromRequest, hashPassword } from "@/lib/auth";
import { createUserSchema } from "@/lib/validators";

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user || user.role !== "superadmin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    select: {
      id: true,
      username: true,
      email: true,
      displayName: true,
      role: true,
      enabled: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ users });
}

export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user || user.role !== "superadmin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = createUserSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid input", details: parsed.error.issues },
      { status: 400 }
    );
  }

  const existing = await prisma.user.findUnique({
    where: { username: parsed.data.username },
  });
  if (existing) {
    return NextResponse.json(
      { error: "Username already exists" },
      { status: 409 }
    );
  }

  const newUser = await prisma.user.create({
    data: {
      username: parsed.data.username,
      passwordHash: await hashPassword(parsed.data.password),
      displayName: parsed.data.displayName,
      email: parsed.data.email || null,
      role: parsed.data.role,
    },
    select: {
      id: true,
      username: true,
      email: true,
      displayName: true,
      role: true,
      enabled: true,
    },
  });

  return NextResponse.json({ user: newUser }, { status: 201 });
}
