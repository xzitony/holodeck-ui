"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { ActiveReservationBanner } from "@/components/reservations/active-banner";
import { ActiveJobsBanner } from "@/components/deployments/active-jobs-banner";
import { BuildFooter } from "@/components/layout/build-footer";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [loading, user, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted-foreground">Redirecting to login...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <div className="flex-1 flex">
        <Sidebar />
        <div className="flex-1 flex flex-col">
          <ActiveReservationBanner />
          <ActiveJobsBanner />
          <main className="flex-1 p-6">{children}</main>
          <BuildFooter />
        </div>
      </div>
    </div>
  );
}
