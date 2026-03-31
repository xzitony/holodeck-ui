import nodemailer from "nodemailer";
import { Resend } from "resend";
import { prisma } from "./db";

type EmailProvider = "none" | "smtp" | "resend";

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

interface EmailConfig {
  provider: EmailProvider;
  // SMTP
  smtpHost?: string;
  smtpPort?: number;
  smtpUsername?: string;
  smtpPassword?: string;
  smtpFrom?: string;
  smtpSecure?: boolean;
  // Resend
  resendApiKey?: string;
  resendFrom?: string;
}

async function getEmailConfig(): Promise<EmailConfig> {
  const configs = await prisma.globalConfig.findMany({
    where: {
      key: {
        in: [
          "email_provider",
          "email_smtp_host",
          "email_smtp_port",
          "email_smtp_username",
          "email_smtp_password",
          "email_smtp_from",
          "email_smtp_secure",
          "email_resend_api_key",
          "email_resend_from",
        ],
      },
    },
  });

  const m = new Map(configs.map((c) => [c.key, c.value]));

  return {
    provider: (m.get("email_provider") || "none") as EmailProvider,
    smtpHost: m.get("email_smtp_host"),
    smtpPort: parseInt(m.get("email_smtp_port") || "587", 10),
    smtpUsername: m.get("email_smtp_username"),
    smtpPassword: m.get("email_smtp_password"),
    smtpFrom: m.get("email_smtp_from"),
    smtpSecure: m.get("email_smtp_secure") === "true",
    resendApiKey: m.get("email_resend_api_key"),
    resendFrom: m.get("email_resend_from"),
  };
}

async function sendViaSMTP(config: EmailConfig, options: EmailOptions): Promise<void> {
  if (!config.smtpHost) throw new Error("SMTP host not configured");
  if (!config.smtpFrom) throw new Error("SMTP from address not configured");

  const transport = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort || 587,
    secure: config.smtpSecure,
    auth: config.smtpUsername
      ? { user: config.smtpUsername, pass: config.smtpPassword }
      : undefined,
  });

  await transport.sendMail({
    from: config.smtpFrom,
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text,
  });
}

async function sendViaResend(config: EmailConfig, options: EmailOptions): Promise<void> {
  if (!config.resendApiKey) throw new Error("Resend API key not configured");
  if (!config.resendFrom) throw new Error("Resend from address not configured");

  const resend = new Resend(config.resendApiKey);

  const { error } = await resend.emails.send({
    from: config.resendFrom,
    to: options.to,
    subject: options.subject,
    html: options.html,
    text: options.text,
  });

  if (error) throw new Error(error.message);
}

/**
 * Send an email using the configured provider.
 * Silently returns if provider is "none" or not configured.
 */
export async function sendEmail(options: EmailOptions): Promise<{ sent: boolean; error?: string }> {
  try {
    const config = await getEmailConfig();

    if (config.provider === "none") {
      return { sent: false };
    }

    if (config.provider === "smtp") {
      await sendViaSMTP(config, options);
      return { sent: true };
    }

    if (config.provider === "resend") {
      await sendViaResend(config, options);
      return { sent: true };
    }

    return { sent: false, error: `Unknown provider: ${config.provider}` };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown email error";
    console.error(`[email] Failed to send: ${message}`);
    return { sent: false, error: message };
  }
}

/**
 * Send a test email to verify configuration.
 */
export async function sendTestEmail(to: string): Promise<{ success: boolean; message: string }> {
  const config = await getEmailConfig();

  if (config.provider === "none") {
    return { success: false, message: "Email provider is set to 'none'" };
  }

  const result = await sendEmail({
    to,
    subject: "Holodeck UI - Test Email",
    html: `
      <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
        <h2>Test Email</h2>
        <p>This is a test email from Holodeck Router UI.</p>
        <p>Your email notifications are configured correctly using <strong>${config.provider.toUpperCase()}</strong>.</p>
        <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
        <p style="font-size: 12px; color: #9ca3af;">Sent from Holodeck Router UI</p>
      </div>
    `,
    text: `Test Email\n\nThis is a test email from Holodeck Router UI.\nYour email notifications are configured correctly using ${config.provider.toUpperCase()}.`,
  });

  if (result.sent) {
    return { success: true, message: `Test email sent to ${to}` };
  }
  return { success: false, message: result.error || "Failed to send" };
}

/**
 * Get the list of admin email addresses for notifications.
 */
export async function getNotifyRecipients(): Promise<string[]> {
  const notifyConfig = await prisma.globalConfig.findUnique({
    where: { key: "email_notify_recipients" },
  });

  if (!notifyConfig?.value) return [];
  return notifyConfig.value.split(",").map((e) => e.trim()).filter(Boolean);
}

/**
 * Send a deployment notification email to all configured recipients.
 */
export async function sendDeploymentNotification(event: {
  status: "started" | "completed" | "failed";
  name: string;
  userName: string;
  duration?: string;
  notifyUserEmail?: string;
}): Promise<void> {
  const notifyOnConfig = await prisma.globalConfig.findUnique({
    where: { key: "email_notify_on" },
  });
  const notifyOn = notifyOnConfig?.value || "none";

  // Collect admin recipients based on global preference
  const adminRecipients =
    notifyOn === "none" ? [] :
    notifyOn === "failures" && event.status !== "failed" ? [] :
    await getNotifyRecipients();

  // Merge with the deploying user's email (if they opted in)
  const allRecipients = new Set([...adminRecipients]);
  if (event.notifyUserEmail) allRecipients.add(event.notifyUserEmail);

  if (allRecipients.size === 0) return;

  const statusLabel = event.status.charAt(0).toUpperCase() + event.status.slice(1);
  const statusColor =
    event.status === "completed" ? "#22c55e" :
    event.status === "failed" ? "#ef4444" : "#3b82f6";

  const subject = `[Holodeck] Deployment ${statusLabel}: ${event.name}`;

  const html = `
    <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
      <h2 style="color: ${statusColor};">Deployment ${statusLabel}</h2>
      <table style="border-collapse: collapse; width: 100%;">
        <tr>
          <td style="padding: 8px 12px; font-weight: bold; color: #6b7280;">Name</td>
          <td style="padding: 8px 12px;">${event.name}</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; font-weight: bold; color: #6b7280;">Status</td>
          <td style="padding: 8px 12px; color: ${statusColor}; font-weight: bold;">${statusLabel}</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; font-weight: bold; color: #6b7280;">Started By</td>
          <td style="padding: 8px 12px;">${event.userName}</td>
        </tr>
        ${event.duration ? `
        <tr>
          <td style="padding: 8px 12px; font-weight: bold; color: #6b7280;">Duration</td>
          <td style="padding: 8px 12px;">${event.duration}</td>
        </tr>` : ""}
      </table>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
      <p style="font-size: 12px; color: #9ca3af;">Sent from Holodeck Router UI</p>
    </div>
  `;

  const text = `Deployment ${statusLabel}: ${event.name}\nStarted By: ${event.userName}${event.duration ? `\nDuration: ${event.duration}` : ""}`;

  for (const to of allRecipients) {
    await sendEmail({ to, subject, html, text });
  }
}

/**
 * Get the configured app base URL (for links in emails).
 */
async function getAppBaseUrl(): Promise<string> {
  const config = await prisma.globalConfig.findUnique({
    where: { key: "app_base_url" },
  });
  return config?.value || "";
}

/**
 * Format a date for email display.
 */
function formatDateTime(date: Date): string {
  return date.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/**
 * Send a reservation confirmation email to the user who created it.
 */
export async function sendReservationConfirmation(reservation: {
  title: string;
  startTime: Date;
  endTime: Date;
  userEmail: string;
  userName: string;
}): Promise<void> {
  const emailConfig = await getEmailConfig();
  if (emailConfig.provider === "none") return;

  const baseUrl = await getAppBaseUrl();
  const dashboardLink = baseUrl ? `${baseUrl}/dashboard/reservations` : "";

  const subject = `[Holodeck] Reservation Confirmed: ${reservation.title}`;
  const html = `
    <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
      <h2 style="color: #22c55e;">Reservation Confirmed</h2>
      <table style="border-collapse: collapse; width: 100%;">
        <tr>
          <td style="padding: 8px 12px; font-weight: bold; color: #6b7280;">Title</td>
          <td style="padding: 8px 12px;">${reservation.title}</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; font-weight: bold; color: #6b7280;">Start</td>
          <td style="padding: 8px 12px;">${formatDateTime(reservation.startTime)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; font-weight: bold; color: #6b7280;">End</td>
          <td style="padding: 8px 12px;">${formatDateTime(reservation.endTime)}</td>
        </tr>
      </table>
      ${dashboardLink ? `<p style="margin-top: 16px;"><a href="${dashboardLink}" style="color: #3b82f6;">View My Reservations →</a></p>` : ""}
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
      <p style="font-size: 12px; color: #9ca3af;">Sent from Holodeck Router UI</p>
    </div>
  `;
  const text = `Reservation Confirmed: ${reservation.title}\nStart: ${formatDateTime(reservation.startTime)}\nEnd: ${formatDateTime(reservation.endTime)}${dashboardLink ? `\n\nView: ${dashboardLink}` : ""}`;

  await sendEmail({ to: reservation.userEmail, subject, html, text });
}

/**
 * Send a reservation reminder email (5 minutes before start).
 */
export async function sendReservationReminder(reservation: {
  title: string;
  startTime: Date;
  endTime: Date;
  userEmail: string;
  userName: string;
}): Promise<void> {
  const emailConfig = await getEmailConfig();
  if (emailConfig.provider === "none") return;

  const baseUrl = await getAppBaseUrl();
  const dashboardLink = baseUrl ? `${baseUrl}/dashboard/environment` : "";

  const subject = `[Holodeck] Reminder: ${reservation.title} starts soon`;
  const html = `
    <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
      <h2 style="color: #3b82f6;">Reservation Starting Soon</h2>
      <p>Your reservation <strong>${reservation.title}</strong> starts in about 5 minutes.</p>
      <table style="border-collapse: collapse; width: 100%;">
        <tr>
          <td style="padding: 8px 12px; font-weight: bold; color: #6b7280;">Start</td>
          <td style="padding: 8px 12px;">${formatDateTime(reservation.startTime)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; font-weight: bold; color: #6b7280;">End</td>
          <td style="padding: 8px 12px;">${formatDateTime(reservation.endTime)}</td>
        </tr>
      </table>
      ${dashboardLink ? `<p style="margin-top: 16px;"><a href="${dashboardLink}" style="color: #3b82f6; font-weight: bold;">Open Dashboard →</a></p>` : ""}
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
      <p style="font-size: 12px; color: #9ca3af;">Sent from Holodeck Router UI</p>
    </div>
  `;
  const text = `Reminder: ${reservation.title} starts soon\nStart: ${formatDateTime(reservation.startTime)}\nEnd: ${formatDateTime(reservation.endTime)}${dashboardLink ? `\n\nOpen Dashboard: ${dashboardLink}` : ""}`;

  await sendEmail({ to: reservation.userEmail, subject, html, text });
}

/**
 * Send a reservation cancellation email to the reservation owner.
 */
export async function sendReservationCancellation(reservation: {
  title: string;
  startTime: Date;
  endTime: Date;
  userEmail: string;
  cancelledBy: string;
}): Promise<void> {
  const emailConfig = await getEmailConfig();
  if (emailConfig.provider === "none") return;

  const subject = `[Holodeck] Reservation Cancelled: ${reservation.title}`;
  const html = `
    <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
      <h2 style="color: #ef4444;">Reservation Cancelled</h2>
      <table style="border-collapse: collapse; width: 100%;">
        <tr>
          <td style="padding: 8px 12px; font-weight: bold; color: #6b7280;">Title</td>
          <td style="padding: 8px 12px;">${reservation.title}</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; font-weight: bold; color: #6b7280;">Start</td>
          <td style="padding: 8px 12px;">${formatDateTime(reservation.startTime)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; font-weight: bold; color: #6b7280;">End</td>
          <td style="padding: 8px 12px;">${formatDateTime(reservation.endTime)}</td>
        </tr>
        <tr>
          <td style="padding: 8px 12px; font-weight: bold; color: #6b7280;">Cancelled By</td>
          <td style="padding: 8px 12px;">${reservation.cancelledBy}</td>
        </tr>
      </table>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
      <p style="font-size: 12px; color: #9ca3af;">Sent from Holodeck Router UI</p>
    </div>
  `;
  const text = `Reservation Cancelled: ${reservation.title}\nStart: ${formatDateTime(reservation.startTime)}\nEnd: ${formatDateTime(reservation.endTime)}\nCancelled By: ${reservation.cancelledBy}`;

  await sendEmail({ to: reservation.userEmail, subject, html, text });
}
