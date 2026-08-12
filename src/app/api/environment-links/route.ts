import { NextResponse } from "next/server";
import { getUserFromRequest, hasMinimumRole, type UserRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import linksConfig from "../../../../config/environment-links.json";

export async function GET(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const globalConfigs = await prisma.globalConfig.findMany({
    where: { key: { in: ["ssh_host", "infra_esx_ip", "infra_vcenter_ip"] } },
  });
  const configMap = new Map(globalConfigs.map((c) => [c.key, c.value]));
  const holorouterHost = configMap.get("ssh_host") || "";
  const esxIp = configMap.get("infra_esx_ip") || "";
  const vcenterIp = configMap.get("infra_vcenter_ip") || "";

  const categories = linksConfig.categories
    .filter((cat) => {
      const minRole = "minRole" in cat ? (cat.minRole as UserRole) : undefined;
      return !minRole || hasMinimumRole(user.role as UserRole, minRole);
    })
    .map((cat) => {
      const links = cat.links.map((link) => ({
        ...link,
        url: link.url.replace("{{holorouterHost}}", holorouterHost),
      }));

      // Optional, admin-configured convenience links -- only shown once an IP is set
      if (cat.label === "Holodeck Infrastructure") {
        if (esxIp) {
          links.push({
            name: "ESX Host (Holodeck)",
            description: "ESXi host running this Holodeck deployment",
            url: `https://${esxIp}/ui`,
            username: "root",
            conditions: {},
          });
        }
        if (vcenterIp) {
          links.push({
            name: "vCenter",
            description: "vCenter managing the Holodeck ESXi host",
            url: `https://${vcenterIp}/ui`,
            username: "administrator@vsphere.local",
            conditions: {},
          });
        }
      }

      return { ...cat, links };
    });

  return NextResponse.json({ categories });
}
