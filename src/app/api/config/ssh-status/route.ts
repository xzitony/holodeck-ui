import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUserFromRequest } from "@/lib/auth";

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const configs = await prisma.globalConfig.findMany({
    where: { key: { in: ["ssh_host", "ssh_username"] } },
  });

  const configMap = new Map(configs.map((c) => [c.key, c.value]));
  const configured = !!(configMap.get("ssh_host") && configMap.get("ssh_username"));

  return NextResponse.json({ configured });
}
