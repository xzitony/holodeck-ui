import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";
import commands from "../config/commands.json";

const prisma = new PrismaClient();

async function main() {
  // Create default super admin
  const existing = await prisma.user.findUnique({
    where: { username: "admin" },
  });

  if (!existing) {
    await prisma.user.create({
      data: {
        username: "admin",
        passwordHash: await hash("HoloDeck!Admin1", 12),
        displayName: "Super Admin",
        role: "superadmin",
      },
    });
    console.log("Created default super admin (admin / HoloDeck!Admin1)");
  }

  // Seed command definitions
  for (const cmd of commands) {
    await prisma.commandDefinition.upsert({
      where: { slug: cmd.slug },
      update: {
        name: cmd.name,
        description: cmd.description,
        template: cmd.template,
        parameters: JSON.stringify(cmd.parameters),
        category: cmd.category,
        requiredRole: cmd.requiredRole,
        sortOrder: cmd.sortOrder,
        isBuiltIn: true,
      },
      create: {
        name: cmd.name,
        slug: cmd.slug,
        description: cmd.description,
        template: cmd.template,
        parameters: JSON.stringify(cmd.parameters),
        category: cmd.category,
        requiredRole: cmd.requiredRole,
        sortOrder: cmd.sortOrder,
        isBuiltIn: true,
      },
    });
  }
  console.log(`Seeded ${commands.length} command definitions`);

  // Seed default global config placeholders
  const defaultConfigs = [
    { key: "ssh_host", value: "", description: "Holorouter IP address", sensitive: false },
    { key: "ssh_port", value: "22", description: "Holorouter SSH port", sensitive: false },
    { key: "ssh_username", value: "root", description: "Holorouter SSH username", sensitive: false },
    { key: "ssh_password", value: "", description: "Holorouter SSH password", sensitive: true },
    { key: "esx_host", value: "", description: "ESXi/vCenter hostname", sensitive: false },
    { key: "esx_username", value: "", description: "ESXi/vCenter username", sensitive: false },
    { key: "esx_password", value: "", description: "ESXi/vCenter password", sensitive: true },
    { key: "datastore_name", value: "", description: "Target datastore for deployments", sensitive: false },
    { key: "trunk_port_group_name_site_a", value: "", description: "Trunk port group name on ESXi (Site A)", sensitive: false },
    { key: "trunk_port_group_name_site_b", value: "", description: "Trunk port group name on ESXi (Site B)", sensitive: false },
    { key: "cluster_name", value: "", description: "vCenter cluster name (if targeting vCenter)", sensitive: false },
    { key: "dc_name", value: "", description: "vCenter datacenter name (if targeting vCenter)", sensitive: false },
    { key: "offline_depot_ip", value: "", description: "Offline depot appliance IP", sensitive: false },
    { key: "offline_depot_port", value: "443", description: "Offline depot port", sensitive: false },
    { key: "offline_depot_username", value: "", description: "Offline depot username", sensitive: false },
    { key: "offline_depot_password", value: "", description: "Offline depot password", sensitive: true },
    { key: "offline_depot_protocol", value: "https", description: "Offline depot protocol (http/https)", sensitive: false },
    { key: "online_depot_token", value: "", description: "Broadcom download token", sensitive: true },
    { key: "depot_type", value: "Offline", description: "Depot type (Online/Offline)", sensitive: false },
    { key: "vcf_version", value: "9.0.2.0", description: "VCF version to deploy", sensitive: false },
    { key: "default_vsan_mode", value: "ESA", description: "Default vSAN mode (ESA/OSA)", sensitive: false },
    { key: "default_dns_domain", value: "vcf.lab", description: "Default DNS domain for deployments", sensitive: false },
    { key: "depot_ssh_port", value: "22", description: "Depot appliance SSH port (uses Offline Depot IP as host)", sensitive: false },
    { key: "depot_ssh_username", value: "root", description: "Depot appliance SSH username", sensitive: false },
    { key: "depot_ssh_password", value: "", description: "Depot appliance SSH password", sensitive: true },
    { key: "ui_app_title", value: "Holodeck Router UI", description: "Application title in sidebar", sensitive: false },
    { key: "ui_app_subtitle", value: "VCF Management Portal", description: "Subtitle below app title", sensitive: false },
    { key: "ui_logo_url", value: "", description: "Logo image URL (displayed in sidebar)", sensitive: false },
    { key: "ui_color_primary", value: "#3b82f6", description: "Primary accent color", sensitive: false },
    { key: "ui_color_background", value: "#0a0a0a", description: "Page background color", sensitive: false },
    { key: "ui_color_card", value: "#111827", description: "Card/panel background color", sensitive: false },
    { key: "ui_color_sidebar", value: "#111827", description: "Sidebar background color", sensitive: false },
    // Email notifications
    { key: "email_provider", value: "none", description: "Email provider (none/smtp/resend)", sensitive: false },
    { key: "email_smtp_host", value: "", description: "SMTP server hostname", sensitive: false },
    { key: "email_smtp_port", value: "587", description: "SMTP server port", sensitive: false },
    { key: "email_smtp_username", value: "", description: "SMTP username", sensitive: false },
    { key: "email_smtp_password", value: "", description: "SMTP password", sensitive: true },
    { key: "email_smtp_from", value: "", description: "SMTP from address", sensitive: false },
    { key: "email_smtp_secure", value: "false", description: "Use TLS for SMTP (true/false)", sensitive: false },
    { key: "email_resend_api_key", value: "", description: "Resend API key", sensitive: true },
    { key: "email_resend_from", value: "onboarding@resend.dev", description: "Resend from address", sensitive: false },
    { key: "email_notify_on", value: "none", description: "When to send notifications (none/failures/all)", sensitive: false },
    { key: "email_notify_recipients", value: "", description: "Comma-separated email addresses for notifications", sensitive: false },
    { key: "email_reservation_reminders", value: "false", description: "Send reminder emails 5 minutes before reservations (true/false)", sensitive: false },
    // App
    { key: "app_base_url", value: "", description: "Public URL of this app (e.g. https://holodeck.lab.local)", sensitive: false },
  ];

  for (const cfg of defaultConfigs) {
    await prisma.globalConfig.upsert({
      where: { key: cfg.key },
      update: { description: cfg.description },
      create: cfg,
    });
  }
  console.log("Seeded global config placeholders");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
