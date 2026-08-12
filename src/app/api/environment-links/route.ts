import { NextResponse } from "next/server";
import { getUserFromRequest, hasMinimumRole, type UserRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import linksConfig from "../../../../config/environment-links.json";

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const hostRow = await prisma.globalConfig.findUnique({ where: { key: "ssh_host" } });
  const holorouterHost = hostRow?.value || "";

  const categories = linksConfig.categories
    .filter((cat) => {
      const minRole = "minRole" in cat ? (cat.minRole as UserRole) : undefined;
      return !minRole || hasMinimumRole(user.role as UserRole, minRole);
    })
    .map((cat) => ({
      ...cat,
      links: cat.links.map((link) => ({
        ...link,
        url: link.url.replace("{{holorouterHost}}", holorouterHost),
      })),
    }));

  return NextResponse.json({ categories });
}
