/**
 * Tiny Mailpit (Supabase's local SMTP inbox) client for e2e tests. Local
 * Supabase ships Mailpit on port 54344 to capture all outbound emails so
 * tests can extract OTPs and recovery codes without real SMTP.
 */

const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54344';

interface MailpitMessage {
  ID: string;
  To: { Address: string; Name: string }[];
  Subject: string;
  Created: string;
}

interface MailpitListResponse {
  messages: MailpitMessage[];
}

interface MailpitFullMessage {
  Text: string;
  HTML?: string;
  Subject: string;
  To: { Address: string; Name: string }[];
}

export async function clearMailpit(): Promise<void> {
  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });
}

/**
 * Polls Mailpit until a message arrives for the given recipient. Returns the
 * full message (Text/HTML). Throws if no message arrives within `timeoutMs`.
 */
export async function waitForEmail(
  recipient: string,
  timeoutMs = 5000,
): Promise<MailpitFullMessage> {
  const recipientLower = recipient.toLowerCase();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const list = (await (await fetch(`${MAILPIT_URL}/api/v1/messages`)).json()) as MailpitListResponse;
    const match = list.messages?.find((m) =>
      m.To?.some((t) => t.Address.toLowerCase() === recipientLower),
    );
    if (match) {
      return (await (
        await fetch(`${MAILPIT_URL}/api/v1/message/${match.ID}`)
      ).json()) as MailpitFullMessage;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No email arrived for ${recipient} within ${timeoutMs}ms`);
}

/**
 * Supabase recovery templates embed the 6-digit OTP code as `{{ .Token }}`.
 * Match the first sequence of 6 digits in the message body.
 */
export function extractOtp(message: MailpitFullMessage): string {
  const haystack = `${message.Text ?? ''} ${message.HTML ?? ''}`;
  const match = haystack.match(/\b(\d{6})\b/);
  if (!match) {
    throw new Error('OTP not found in email body');
  }
  return match[1];
}
