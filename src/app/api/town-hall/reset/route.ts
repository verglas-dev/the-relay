import { cookies } from "next/headers";
import { after, NextResponse } from "next/server";
import { callerIp, rateLimit } from "@/lib/relay-bridge";
import { mailConfigured, sendMail } from "@/lib/contact-mail";
import {
  RESET_MAX_AGE,
  checkPassphrase,
  emailKey,
  mintPassphraseReset,
  normalizeEmail,
  publicAccount,
  townHallConfigured,
} from "@/lib/human-account";
import { rememberKeeper } from "@/lib/keeper-session";
import { accountByEmail, resetPassphrase } from "@/lib/town-hall";
import { townUrl } from "@/lib/verglas-site";

/**
 * A forgotten passphrase.
 *
 * POST asks for a link; PUT uses one.
 *
 * Asking gets the same answer whether or not the address keeps a place here,
 * and the answer is sent before the town even looks — the lookup and the mail
 * both happen in `after`, so a reply that took longer to send a letter cannot
 * be timed into a list of the town's keepers.
 *
 * The link goes to the address the keeper gave when they redeemed their
 * permit, and only there. It is never shown on any page, and nothing about it
 * is returned to whoever asked.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REQUESTS_PER_IP_PER_MIN = 5;
/** One letter a minute to any one inbox, so this cannot be pointed at somebody to flood it. */
const LETTERS_PER_ADDRESS_PER_MIN = 1;
const USES_PER_IP_PER_MIN = 10;
const MAX_BODY_BYTES = 8 * 1024;

/**
 * Where the link in the mail points. Configuration, or the town's own address
 * — never the request. A Host header is whatever the caller wrote, and a link
 * built from it would carry the token to a host of their choosing.
 */
function deskUrl(): string {
  const configured = process.env.VERGLAS_PUBLIC_ORIGIN?.trim();
  if (configured) {
    try {
      return `${new URL(configured).origin}/town-hall`;
    } catch {
      // A typo in the config falls back to the town, not to the request.
    }
  }
  return townUrl("/town-hall");
}

function letter(link: string): { subject: string; text: string } {
  const minutes = Math.round(RESET_MAX_AGE / 60);
  return {
    subject: "Choosing a new passphrase at the Verglas town hall",
    text:
      `Somebody — hopefully you — asked to choose a new passphrase for the place you keep in Verglas.\n\n` +
      `To choose one, open this link within ${minutes} minutes:\n\n` +
      `${link}\n\n` +
      `It works once. Choosing a new passphrase signs you out everywhere else.\n\n` +
      `If this wasn't you, you can ignore this mail. Your passphrase hasn't changed, ` +
      `and the link is no use to anybody who can't read it.\n\n` +
      `— The town hall, Verglas\n`,
  };
}

async function readBody(request: Request): Promise<Record<string, unknown> | NextResponse> {
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json({ ok: false, error: "That request is too large." }, { status: 413 });
    }
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "That request could not be read." }, { status: 400 });
  }
}

export async function POST(request: Request) {
  if (!townHallConfigured()) {
    return NextResponse.json({ ok: false, error: "The town hall is closed on this server." }, { status: 503 });
  }
  if (!mailConfigured()) {
    return NextResponse.json(
      { ok: false, error: "This town hall can't send mail, so it can't send you a link. Write to the town instead." },
      { status: 503 },
    );
  }

  const ip = callerIp(request);
  if (!rateLimit(`townhall-reset:${ip}`, REQUESTS_PER_IP_PER_MIN)) {
    return NextResponse.json(
      { ok: false, error: "Too many attempts. Try again in a minute." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const body = await readBody(request);
  if (body instanceof NextResponse) return body;

  const email = normalizeEmail(body.email);
  if (!email) {
    return NextResponse.json(
      { ok: false, error: "Some answers still need work.", fields: { email: "The address you redeemed your permit with." } },
      { status: 400 },
    );
  }

  // Keyed on the address as typed, before anybody looks it up, so being told
  // to wait says nothing about whether the address is somebody's.
  const key = emailKey(email);
  if (!rateLimit(`townhall-reset-letter:${key}`, LETTERS_PER_ADDRESS_PER_MIN)) {
    return NextResponse.json(
      { ok: false, error: "A link was just sent to that address. Give it a minute, and check spam." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  after(async () => {
    const account = await accountByEmail(key);
    if (!account) return;
    const token = mintPassphraseReset(account);
    if (!token) return;

    const result = await sendMail({
      to: account.email,
      fromName: "Verglas town hall",
      ...letter(`${deskUrl()}#reset=${token}`),
    });
    if (!result.ok) console.error("Town hall reset mail failed:", result.error);
  });

  return NextResponse.json({ ok: true });
}

export async function PUT(request: Request) {
  if (!townHallConfigured()) {
    return NextResponse.json({ ok: false, error: "The town hall is closed on this server." }, { status: 503 });
  }

  const ip = callerIp(request);
  if (!rateLimit(`townhall-reset-use:${ip}`, USES_PER_IP_PER_MIN)) {
    return NextResponse.json(
      { ok: false, error: "Too many attempts. Try again in a minute." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const body = await readBody(request);
  if (body instanceof NextResponse) return body;

  const problem = checkPassphrase(body.passphrase);
  if (problem) {
    return NextResponse.json(
      { ok: false, error: "Some answers still need work.", fields: { passphrase: problem } },
      { status: 400 },
    );
  }

  const result = await resetPassphrase({
    token: typeof body.token === "string" ? body.token : "",
    next: body.passphrase as string,
  });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });

  const jar = await cookies();
  if (!rememberKeeper(result.account, jar)) {
    return NextResponse.json(
      { ok: false, error: "Your new passphrase is set, but the town could not sign you in. Try signing in." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, account: publicAccount(result.account) });
}
