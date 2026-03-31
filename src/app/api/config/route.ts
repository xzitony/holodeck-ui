import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user || user.role !== "superadmin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const configs = await prisma.globalConfig.findMany({
    orderBy: { key: "asc" },
  });

  // Mask sensitive values
  const masked = configs.map((c) => ({
    ...c,
    value: c.sensitive && c.value ? "••••••••" : c.value,
  }));

  return NextResponse.json({ configs: masked });
}

export async function PUT(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user || user.role !== "superadmin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { configs } = body as {
    configs: { key: string; value: string }[];
  };

  if (!Array.isArray(configs)) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  for (const cfg of configs) {
    // Skip unchanged masked values
    if (cfg.value === "••••••••") continue;

    await prisma.globalConfig.upsert({
      where: { key: cfg.key },
      update: { value: cfg.value },
      create: {
        key: cfg.key,
        value: cfg.value,
        description: "",
      },
    });
  }

  await prisma.auditLog.create({
    data: {
      userId: user.userId,
      action: "config_update",
      details: JSON.stringify({ keys: configs.map((c) => c.key) }),
      status: "success",
    },
  });

  return NextResponse.json({ success: true });
}
