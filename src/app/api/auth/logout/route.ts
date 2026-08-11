import { NextResponse } from "next/server";
import { isSecureRequest, COOKIE_NAME } from "@/lib/auth";

export async function POST(request: Request) {
  const response = NextResponse.json({ success: true });

  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: isSecureRequest(request),
    sameSite: "strict",
    maxAge: 0,
    path: "/",
  });

  return response;
}
