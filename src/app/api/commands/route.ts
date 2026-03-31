import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserFromRequest, hasMinimumRole, type UserRole } from "@/lib/auth";

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Super admins with ?all=true get all commands (including disabled) for the admin page
  const url = new URL(request.url);
  const showAll = url.searchParams.get("all") === "true" && user.role === "superadmin";

  const commands = await prisma.commandDefinition.findMany({
    where: showAll ? {} : { isEnabled: true },
    orderBy: { sortOrder: "asc" },
  });

  // Filter by role (skip for admin view)
  const filtered = showAll
    ? commands
    : commands.filter((cmd) =>
        hasMinimumRole(user.role, cmd.requiredRole as UserRole)
      );

  const parsed = filtered.map((cmd) => ({
    ...cmd,
    parameters: JSON.parse(cmd.parameters),
  }));

  return NextResponse.json({ commands: parsed });
}

export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user || user.role !== "superadmin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const command = await prisma.commandDefinition.create({
    data: {
      name: body.name,
      slug: body.slug,
      description: body.description,
      template: body.template,
      parameters: JSON.stringify(body.parameters || []),
      category: body.category || "general",
      requiredRole: body.requiredRole || "user",
      sortOrder: body.sortOrder || 0,
    },
  });

  return NextResponse.json({ command }, { status: 201 });
}
