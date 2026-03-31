import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Public endpoint — no auth required (used by layout before login)
export async function GET() {
  const configs = await prisma.globalConfig.findMany({
    where: { key: { startsWith: "ui_" } },
  });

  const ui: Record<string, string> = {};
  for (const c of configs) {
    ui[c.key] = c.value;
  }

  return NextResponse.json({ ui });
}
