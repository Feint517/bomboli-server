import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly fromEmail = process.env.MAIL_FROM_EMAIL ?? '';
  private readonly fromName = process.env.MAIL_FROM_NAME ?? 'Bomboli';

  private async send(to: string, subject: string, html: string): Promise<void> {
    const token = process.env.MAILTRAP_API_TOKEN;
    const inboxId = process.env.MAILTRAP_INBOX_ID;
    if (!token || !inboxId) {
      this.logger.warn(`Skipping email to ${to} (Mailtrap config missing): ${subject}`);
      return;
    }
    const res = await fetch(`https://sandbox.api.mailtrap.io/api/send/${inboxId}`, {
      method: 'POST',
      headers: {
        'Api-Token': token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: { email: this.fromEmail, name: this.fromName },
        to: [{ email: to }],
        subject,
        html,
      }),
    });
    if (!res.ok) {
      const body = await res.text();
      this.logger.error(`Mailtrap send failed for ${to}: ${res.status} ${body}`);
      throw new Error(`Mailtrap send failed: ${res.status} ${body}`);
    }
  }

  async sendPasswordResetEmail(email: string, token: string): Promise<void> {
    await this.send(
      email,
      'Reset your password',
      `<h2>Reset Password</h2><p>Your reset code is:</p><h1>${token}</h1>`,
    );
  }

  async sendEmailVerification(email: string, token: string): Promise<void> {
    await this.send(
      email,
      'Verify your email',
      `<h2>Email Verification</h2><p>Your verification code is:</p><h1>${token}</h1>`,
    );
  }
}