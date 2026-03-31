import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";

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

  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.description !== undefined) data.description = body.description;
  if (body.template !== undefined) data.template = body.template;
  if (body.parameters !== undefined)
    data.parameters = JSON.stringify(body.parameters);
  if (body.category !== undefined) data.category = body.category;
  if (body.requiredRole !== undefined) data.requiredRole = body.requiredRole;
  if (body.isEnabled !== undefined) data.isEnabled = body.isEnabled;
  if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;

  const command = await prisma.commandDefinition.update({
    where: { id },
    data,
  });

  return NextResponse.json({ command });
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

  const command = await prisma.commandDefinition.findUnique({
    where: { id },
  });

  if (!command) {
    return NextResponse.json({ error: "Command not found" }, { status: 404 });
  }

  if (command.isBuiltIn) {
    return NextResponse.json(
      { error: "Built-in commands cannot be deleted. Disable them instead." },
      { status: 409 }
    );
  }

  // Check for audit log references
  const auditCount = await prisma.auditLog.count({
    where: { commandId: id },
  });

  if (auditCount > 0) {
    // Soft-delete: just disable it to preserve audit history
    await prisma.commandDefinition.update({
      where: { id },
      data: { isEnabled: false },
    });
    return NextResponse.json({
      success: true,
      message: "Command disabled (has audit history, cannot fully delete)",
    });
  }

  await prisma.commandDefinition.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
