import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * POST /api/config/test-depot-http
 *
 * Tests HTTP/HTTPS connectivity to the Offline Depot appliance.
 * Builds a URL from the configured protocol, IP, and port, then
 * optionally uses Basic auth with the configured credentials.
 */
export async function POST(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user || user.role !== "superadmin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const configs = await prisma.globalConfig.findMany({
    where: {
      key: {
        in: [
          "offline_depot_ip",
          "offline_depot_port",
          "offline_depot_protocol",
          "offline_depot_username",
          "offline_depot_password",
        ],
      },
    },
  });

  const cfg = new Map(configs.map((c) => [c.key, c.value]));
  const ip = cfg.get("offline_depot_ip");
  const port = cfg.get("offline_depot_port") || "443";
  const protocol = cfg.get("offline_depot_protocol") || "https";
  const username = cfg.get("offline_depot_username") || "";
  const password = cfg.get("offline_depot_password") || "";

  if (!ip) {
    return NextResponse.json({
      success: false,
      message: "Offline depot IP is not configured",
    });
  }

  // Build URL — omit port if it's the default for the protocol
  const isDefaultPort =
    (protocol === "http" && port === "80") ||
    (protocol === "https" && port === "443");
  const url = isDefaultPort
    ? `${protocol}://${ip}/`
    : `${protocol}://${ip}:${port}/`;

  try {
    const headers: Record<string, string> = {};
    if (username && password) {
      const encoded = Buffer.from(`${username}:${password}`).toString("base64");
      headers["Authorization"] = `Basic ${encoded}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    const res = await fetch(url, {
      headers,
      signal: controller.signal,
      // Allow self-signed certs in Node.js fetch
      // @ts-expect-error Node.js fetch extension
      rejectUnauthorized: false,
    });

    clearTimeout(timeout);

    if (res.ok) {
      return NextResponse.json({
        success: true,
        message: `Connected to ${url} — HTTP ${res.status}`,
      });
    }

    return NextResponse.json({
      success: false,
      message: `HTTP ${res.status} ${res.statusText} from ${url}`,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Connection failed";
    return NextResponse.json({
      success: false,
      message: `Failed to connect to ${url} — ${msg}`,
    });
  }
}
