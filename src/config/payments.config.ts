import { registerAs } from '@nestjs/config';

export const paymentsConfig = registerAs('payments', () => ({
  stripe: {
    secretKey: process.env.STRIPE_SECRET_KEY ?? '',
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY ?? '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
    enabled: Boolean(process.env.STRIPE_SECRET_KEY),
  },
  paypal: {
    clientId: process.env.PAYPAL_CLIENT_ID ?? '',
    clientSecret: process.env.PAYPAL_CLIENT_SECRET ?? '',
    apiBase: process.env.PAYPAL_API_BASE ?? 'https://api-m.sandbox.paypal.com',
    webhookId: process.env.PAYPAL_WEBHOOK_ID ?? '',
    enabled: Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET),
  },
  pawapay: {
    apiKey: process.env.PAWAPAY_API_KEY ?? '',
    apiBase: process.env.PAWAPAY_API_BASE ?? 'https://api.sandbox.pawapay.io',
    webhookSecret: process.env.PAWAPAY_WEBHOOK_SECRET ?? '',
    enabled: Boolean(process.env.PAWAPAY_API_KEY),
  },
}));

export type PaymentsConfig = ReturnType<typeof paymentsConfig>;
