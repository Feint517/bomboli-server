import { Injectable } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailService {
  private transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST,
    port: Number(process.env.MAIL_PORT ?? 587),
    secure: false,
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS,
    },
  });

  async sendPasswordResetEmail(email: string, token: string) {
    await this.transporter.sendMail({
      from: `"${process.env.MAIL_FROM_NAME}" <${process.env.MAIL_FROM_EMAIL}>`,
      to: email,
      subject: 'Reset your password',
      html: `
        <h2>Reset Password</h2>
        <p>Your reset code is:</p>
        <h1>${token}</h1>
      `,
    });
  }

  async sendEmailVerification(email: string, token: string) {
    await this.transporter.sendMail({
      from: `"${process.env.MAIL_FROM_NAME}" <${process.env.MAIL_FROM_EMAIL}>`,
      to: email,
      subject: 'Verify your email',
      html: `
        <h2>Email Verification</h2>
        <p>Your verification code is:</p>
        <h1>${token}</h1>
      `,
    });
  }
}