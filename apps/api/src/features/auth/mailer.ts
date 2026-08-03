import nodemailer, { type Transporter } from "nodemailer";

import { env, isProduction, isSmtpConfigured } from "../../config/env";
import { logger } from "../../lib/logger";
import { HttpError } from "../../middleware/errorHandler";

/**
 * Outbound email, used only for one-time codes.
 *
 * Three modes, decided once at first use:
 *
 *   1. SMTP configured        -> send for real.
 *   2. No SMTP, development   -> print the message to the server terminal.
 *   3. No SMTP, production    -> refuse with 503.
 *
 * Mode 2 is what makes local development free: no mail provider, no account, no
 * spend, and the code is right there in the terminal you started the server in.
 *
 * It is NOT the old `dev_otp` behaviour, which is worth being precise about.
 * The old build returned the live code in the HTTP response body whenever
 * NODE_ENV was anything other than exactly "production", so anyone who could
 * reach the API could request a code for any address and read it straight out
 * of the response. That is remote account takeover. Printing to stdout only
 * helps someone who is already on the machine running the server, and it is
 * hard-disabled in production by `isProduction`.
 */

/** Whether a code can be delivered at all, by real mail or by terminal. */
export const canDeliverEmail = isSmtpConfigured || !isProduction;

/** True when messages will be printed rather than sent. */
export const isUsingTerminalTransport = !isSmtpConfigured && !isProduction;

let transporter: Transporter | null = null;

function buildTransport(): Transporter {
  if (isUsingTerminalTransport) {
    // Serializes the message instead of connecting anywhere.
    return nodemailer.createTransport({ jsonTransport: true });
  }

  if (env.SMTP_URL) return nodemailer.createTransport(env.SMTP_URL);

  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth:
      env.SMTP_USER && env.SMTP_PASS ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
}

function getTransport(): Transporter {
  if (!canDeliverEmail) {
    // 503, not 500: the request was fine, the server is not configured for it.
    throw new HttpError(
      503,
      "Email delivery is not configured on this server, so verification codes cannot be sent.",
    );
  }
  transporter ??= buildTransport();
  return transporter;
}

const RULE = "─".repeat(64);

/** Prints the message where a developer will actually notice it. */
function printToTerminal(to: string, subject: string, code: string): void {
  process.stdout.write(
    `\n${RULE}\n` +
      `  DEV EMAIL — not sent, SMTP is unconfigured\n` +
      `  To:       ${to}\n` +
      `  Subject:  ${subject}\n` +
      `\n` +
      `  CODE:     ${code}\n` +
      `\n` +
      `  Configure SMTP_* in apps/api/.env to send real mail.\n` +
      `${RULE}\n\n`,
  );
}

const CODE_STYLE = [
  "letter-spacing:8px",
  "color:#0A1628",
  "background:#C9A84C",
  "padding:16px",
  "border-radius:8px",
  "text-align:center",
  "font-family:monospace",
].join(";");

export async function sendOtpEmail(to: string, code: string, subject?: string): Promise<void> {
  const finalSubject = subject ?? "ChatSaints verification code";
  const transport = getTransport();

  await transport.sendMail({
    from: env.MAIL_FROM ?? `"ChatSaints" <${env.SMTP_USER ?? "no-reply@chatsaints.app"}>`,
    to,
    subject: finalSubject,
    text: `Your ChatSaints code is: ${code}\n\nIt expires in 10 minutes.\nIf you did not request it, ignore this email.`,
    html: `<div style="font-family:sans-serif;max-width:480px;margin:auto">
      <h2 style="color:#C9A84C">ChatSaints</h2>
      <p>Your verification code:</p>
      <h1 style="${CODE_STYLE}">${code}</h1>
      <p style="color:#666">It expires in 10 minutes. Do not share it with anyone.</p>
      <p style="color:#666">If you did not request this code, you can ignore this email.</p>
    </div>`,
  });

  if (isUsingTerminalTransport) {
    printToTerminal(to, finalSubject, code);
  } else {
    // Never log the code itself on a real send.
    logger.info("verification code sent", { to });
  }
}
