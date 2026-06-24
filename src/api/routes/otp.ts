/**
 * OTP Routes
 * Email-based login that issues short-lived bearer access tokens.
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { appContext } from '../server.js';
import {
  ApiRole,
  getAccessTokenExpiresIn,
  getJwtSecret,
  issueAccessToken,
  requireAuth,
} from '../middleware/auth.js';

const router = Router();

const DEFAULT_PURPOSE = 'login';

function normalizeEmail(email: unknown): string | null {
  if (typeof email !== 'string') {
    return null;
  }

  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return null;
  }

  return normalized;
}

function getClientIp(req: Request): string {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || '';
}

function getOtpConfig() {
  return {
    length: Number(process.env.OTP_CODE_LENGTH || 6),
    ttlMinutes: Number(process.env.OTP_TTL_MINUTES || 10),
    cooldownSeconds: Number(process.env.OTP_RESEND_COOLDOWN_SECONDS || 60),
    maxAttempts: Number(process.env.OTP_MAX_ATTEMPTS || 5),
  };
}

function hashOtp(email: string, purpose: string, code: string): string {
  const secret = process.env.OTP_SECRET || getJwtSecret();
  return crypto
    .createHmac('sha256', secret)
    .update(`${email}:${purpose}:${code}`)
    .digest('hex');
}

function generateOtp(length: number): string {
  const digits = Math.max(6, Math.min(length, 10));
  const upperBound = 10 ** digits;
  return crypto.randomInt(0, upperBound).toString().padStart(digits, '0');
}

async function resolveOtpUser(email: string): Promise<{ email: string; role: ApiRole; name: string } | null> {
  const authUser = await (appContext.stateManager as any).getAuthUserByEmail(email);

  if (!authUser || authUser.isActive === false || authUser.allowedForOtp === false) {
    return null;
  }

  return {
    email,
    role: authUser.role || 'requester',
    name: authUser.name || email.split('@')[0],
  };
}

function substituteTemplateVariables(text: string, context: Record<string, any>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return context[key] !== undefined ? String(context[key]) : match;
  });
}

async function resolveOtpEmailTemplate(): Promise<{ subject: string; htmlBody: string; matchedTemplate: string } | null> {
  const candidates = [
    process.env.OTP_EMAIL_TEMPLATE_ID,
    'otp-login',
    'auth-otp',
  ].filter((candidate): candidate is string => !!candidate);

  for (const candidate of [...new Set(candidates)]) {
    const template = await (appContext.stateManager as any).getEmailTemplate(candidate)
      || await (appContext.stateManager as any).getEmailTemplateByName(candidate);

    if (template?.isActive !== false) {
      return {
        subject: template.subject,
        htmlBody: template.htmlBody,
        matchedTemplate: candidate,
      };
    }
  }

  return null;
}

async function sendOtpEmail(email: string, code: string, ttlMinutes: number): Promise<boolean> {
  const template = await resolveOtpEmailTemplate();
  if (!template) {
    appContext.logger.error('[OTP] Missing OTP email template. Create generic template otp-login.');
    return false;
  }

  const context = {
    email,
    otpCode: code,
    code,
    expiryMinutes: ttlMinutes,
    expiresInMinutes: ttlMinutes,
    currentTimestamp: new Date().toISOString(),
  };

  appContext.logger.info(`[OTP] Using email template ${template.matchedTemplate}`);
  return appContext.emailService.sendEmail({
    to: email,
    subject: substituteTemplateVariables(template.subject, context),
    html: substituteTemplateVariables(template.htmlBody, context),
  });
}

router.post('/send', async (req: Request, res: Response) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const purpose = typeof req.body?.purpose === 'string' ? req.body.purpose.trim().toLowerCase() : DEFAULT_PURPOSE;
    const config = getOtpConfig();

    if (!email) {
      return res.status(400).json({ error: 'Valid email is required' });
    }

    const otpUser = await resolveOtpUser(email);
    if (!otpUser) {
      appContext.logger.warn(`[OTP] Rejected OTP send for non-allowed email ${email}`);
      return res.status(202).json({
        status: 'accepted',
        message: 'If the email is allowed, a login code will be sent.',
      });
    }

    const activeChallenge = await (appContext.stateManager as any).getActiveOtpChallenge(email, purpose);
    if (activeChallenge?.sentAt) {
      const sentAt = new Date(activeChallenge.sentAt).getTime();
      const retryAt = sentAt + config.cooldownSeconds * 1000;
      if (Date.now() < retryAt) {
        return res.status(429).json({
          error: 'OTP was sent recently',
          retryAfterSeconds: Math.ceil((retryAt - Date.now()) / 1000),
        });
      }
    }

    await (appContext.stateManager as any).cancelOtpChallenges(email, purpose);

    const code = generateOtp(config.length);
    await (appContext.stateManager as any).createOtpChallenge({
      email,
      purpose,
      codeHash: hashOtp(email, purpose, code),
      expiresAt: new Date(Date.now() + config.ttlMinutes * 60 * 1000),
      maxAttempts: config.maxAttempts,
      ipAddress: getClientIp(req),
      userAgent: req.headers['user-agent'],
    });

    const emailSent = await sendOtpEmail(email, code, config.ttlMinutes);
    const shouldEchoOtp = process.env.NODE_ENV !== 'production' && process.env.OTP_ECHO_IN_RESPONSE === 'true';

    if (!emailSent && !shouldEchoOtp) {
      return res.status(503).json({ error: 'Unable to send OTP email' });
    }

    res.status(202).json({
      status: 'sent',
      expiresInSeconds: config.ttlMinutes * 60,
      retryAfterSeconds: config.cooldownSeconds,
      ...(shouldEchoOtp ? { otp: code } : {}),
    });
  } catch (error) {
    appContext.logger.error('[OTP] Send error:', error);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

router.post('/verify', async (req: Request, res: Response) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    const purpose = typeof req.body?.purpose === 'string' ? req.body.purpose.trim().toLowerCase() : DEFAULT_PURPOSE;

    if (!email || !code) {
      return res.status(400).json({ error: 'Email and OTP code are required' });
    }

    const otpUser = await resolveOtpUser(email);
    if (!otpUser) {
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }

    const challenge = await (appContext.stateManager as any).getActiveOtpChallenge(email, purpose);
    if (!challenge) {
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }

    if (new Date(challenge.expiresAt).getTime() < Date.now()) {
      return res.status(410).json({ error: 'OTP expired' });
    }

    if (challenge.attempts >= challenge.maxAttempts) {
      return res.status(429).json({ error: 'Too many OTP attempts' });
    }

    const expectedHash = hashOtp(email, purpose, code);
    const actualHash = String(challenge.codeHash || '');
    const valid =
      actualHash.length === expectedHash.length &&
      crypto.timingSafeEqual(Buffer.from(actualHash, 'hex'), Buffer.from(expectedHash, 'hex'));

    if (!valid) {
      await (appContext.stateManager as any).incrementOtpChallengeAttempts(challenge._id);
      return res.status(401).json({ error: 'Invalid or expired OTP' });
    }

    await (appContext.stateManager as any).markOtpChallengeConsumed(challenge._id);
    await (appContext.stateManager as any).markAuthUserLogin(email);

    const accessToken = issueAccessToken(otpUser);

    res.json({
      accessToken,
      tokenType: 'Bearer',
      expiresIn: getAccessTokenExpiresIn(),
      user: otpUser,
    });
  } catch (error) {
    appContext.logger.error('[OTP] Verify error:', error);
    res.status(500).json({ error: 'Failed to verify OTP' });
  }
});

router.post('/cancel', async (req: Request, res: Response) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const purpose = typeof req.body?.purpose === 'string' ? req.body.purpose.trim().toLowerCase() : DEFAULT_PURPOSE;

    if (!email) {
      return res.status(400).json({ error: 'Valid email is required' });
    }

    const cancelledCount = await (appContext.stateManager as any).cancelOtpChallenges(email, purpose);
    res.json({ status: 'cancelled', cancelledCount });
  } catch (error) {
    appContext.logger.error('[OTP] Cancel error:', error);
    res.status(500).json({ error: 'Failed to cancel OTP' });
  }
});

router.post('/flush', requireAuth({ roles: ['admin'] }), async (req: Request, res: Response) => {
  try {
    const retentionHours = Number(req.body?.consumedRetentionHours || 24);
    const deletedCount = await (appContext.stateManager as any).flushStaleOtpChallenges(new Date(), retentionHours);
    res.json({ status: 'flushed', deletedCount });
  } catch (error) {
    appContext.logger.error('[OTP] Flush error:', error);
    res.status(500).json({ error: 'Failed to flush OTP records' });
  }
});

export default router;
