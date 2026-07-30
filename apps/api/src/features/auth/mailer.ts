import nodemailer, { type Transporter } from "nodemailer";

import { env, isSmtpConfigured } from "../../config/env";
import { HttpError } from "../../middleware/errorHandler";

/**
 * Outbound email, used only for one-time codes.
 *
 * The transport is built lazily. The old module created it at import time from
 * whatever was in the environment, then guessed at whether the credentials were
 * real by string-matching for "your-email" and "change_me".
 */

let transporter: Transporter | null = null;

function buildTransport(): Transporter {
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
  if (!isSmtpConfigured) {
    // 503, not 500: the request was fine, the server is not configured to
    // fulfil it. Never fall back to returning the code to the caller.
    throw new HttpError(
      503,
      "Email delivery is not configured on this server, so verification codes cannot be sent.",
    );
  }
  transporter ??= buildTransport();
  return transporter;
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
  const transport = getTransport();

  await transport.sendMail({
    from: env.MAIL_FROM ?? `"ChatSaints" <${env.SMTP_USER ?? "no-reply@chatsaints.app"}>`,
    to,
    subject: subject ?? "ChatSaints verification code",
    text: `Your ChatSaints code is: ${code}\n\nIt expires in 10 minutes.\nIf you did not request it, ignore this email.`,
    html: `<div style="font-family:sans-serif;max-width:480px;margin:auto">
      <h2 style="color:#C9A84C">ChatSaints</h2>
      <p>Your verification code:</p>
      <h1 style="${CODE_STYLE}">${code}</h1>
      <p style="color:#666">It expires in 10 minutes. Do not share it with anyone.</p>
      <p style="color:#666">If you did not request this code, you can ignore this email.</p>
    </div>`,
  });
}
