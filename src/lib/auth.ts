import { SignJWT, jwtVerify } from "jose";
import { hash, compare } from "bcryptjs";
import { cookies } from "next/headers";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "fallback-secret-change-me"
);
const JWT_EXPIRY = "24h";
const COOKIE_NAME = "holodeck-token";

export type UserRole = "superadmin" | "labadmin" | "user";

export interface JWTPayload {
  userId: string;
  username: string;
  role: UserRole;
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password, 12);
}

export async function verifyPassword(
  password: string,
  hashedPassword: string
): Promise<boolean> {
  return compare(password, hashedPassword);
}

export async function signToken(payload: JWTPayload): Promise<string> {
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY)
    .sign(JWT_SECRET);
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as unknown as JWTPayload;
  } catch {
    return null;
  }
}

export async function getTokenFromRequest(
  request: Request
): Promise<string | null> {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  const cookieStore = await cookies();
  return cookieStore.get(COOKIE_NAME)?.value ?? null;
}

export async function getUserFromRequest(
  request: Request
): Promise<JWTPayload | null> {
  const token = await getTokenFromRequest(request);
  if (!token) return null;
  return verifyToken(token);
}

export function hasMinimumRole(
  userRole: UserRole,
  requiredRole: UserRole
): boolean {
  const hierarchy: Record<UserRole, number> = {
    superadmin: 3,
    labadmin: 2,
    user: 1,
  };
  return hierarchy[userRole] >= hierarchy[requiredRole];
}

export { COOKIE_NAME };
