import nodemailer from "nodemailer";

/**
 * Carrying a contact message to the team's inbox.
 *
 * Any SMTP server will do, and the sending account has nothing to do with the
 * receiving one: delivery to a mailbox anywhere is ordinary mail, so this can
 * send through the site's own domain, a transactional provider, or whatever is
 * already paid for. Worth knowing if the destination is ever a Proton address,
 * since Proton only offers SMTP on its Business plans.
 *
 * Configured entirely by environment, and switched off by leaving it unset.
 * With no SMTP_HOST the form still works and still records everything; it just
 * says so rather than pretending a mail went out.
 */

export interface MailResult {
  ok: boolean;
  /** Set when no SMTP server is configured at all, as opposed to a failure. */
  skipped?: boolean;
  error?: string;
}

export function mailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST?.trim());
}

/**
 * Where contact messages are delivered.
 *
 * Configuration, never a literal in this file. The repository is public, so an
 * address written here would be committed, mirrored, and scraped — a default
 * that looks like a convenience is a permanent one. Unset means nothing is
 * mailed, which is a state the caller reports honestly.
 *
 * It is read server-side only and is never included in any response, so the
 * address is not discoverable from the form itself.
 */
export function contactRecipient(): string {
  return process.env.CONTACT_TO?.trim() || "";
}

export async function sendContactMail(params: {
  subject: string;
  body: string;
  from: string;
}): Promise<MailResult> {
  const host = process.env.SMTP_HOST?.trim();
  if (!host) return { ok: false, skipped: true, error: "no SMTP server is configured" };

  const to = contactRecipient();
  if (!to) return { ok: false, skipped: true, error: "CONTACT_TO is not set" };

  const port = Number(process.env.SMTP_PORT?.trim() || 587);
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASSWORD;
  // 465 is implicit TLS; 587 and 25 start plain and upgrade with STARTTLS.
  const secure = (process.env.SMTP_SECURE?.trim() || (port === 465 ? "true" : "false")) === "true";
  const envelopeFrom = process.env.CONTACT_FROM?.trim() || user;

  if (!envelopeFrom) {
    return { ok: false, error: "SMTP_HOST is set but neither CONTACT_FROM nor SMTP_USER is" };
  }

  const transport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: user && pass ? { user, pass } : undefined,
  });

  // The sender's address goes in the body and in Reply-To, never in From: a
  // server may only claim an address it is authorised for, and forging the
  // visitor's would get the whole message thrown away by SPF or DMARC. It is
  // also unverified — anyone can type anyone's address into that box.
  const replyTo = looksLikeEmail(params.from) ? params.from : undefined;

  try {
    await transport.sendMail({
      from: `"The Relay contact form" <${envelopeFrom}>`,
      to,
      replyTo,
      subject: `[The Relay] ${params.subject}`,
      text:
        `${params.body}\n\n` +
        `— \n` +
        `From: ${params.from || "(not given)"}\n` +
        `Sent from the contact form at The Relay.\n`,
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "the mail server refused it" };
  } finally {
    transport.close();
  }
}

function looksLikeEmail(value: string): boolean {
  const trimmed = value.trim();
  // Deliberately loose. This only decides whether a reply-to header is worth
  // setting, and a header is not the place to adjudicate what an address is.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) && trimmed.length <= 254;
}
