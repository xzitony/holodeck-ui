"use client";

import { useContext } from "react";
import { AuthContext } from "@/providers/auth-provider";

export function useAuth() {
  return useContext(AuthContext);
}
