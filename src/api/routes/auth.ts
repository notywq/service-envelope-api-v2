/**
 * Authentication Routes
 * OTP verification issues bearer tokens. These routes inspect or validate tokens.
 */

import { Router, Request, Response } from 'express';
import { getAccessTokenExpiresIn, requireAuth } from '../middleware/auth.js';

const router = Router();

router.post('/login', (_req: Request, res: Response) => {
  res.status(410).json({
    error: 'Password login is disabled. Use POST /api/OTP/send and POST /api/OTP/verify.',
  });
});

router.post('/verify', requireAuth(), (req: Request, res: Response) => {
  res.json({
    valid: true,
    user: req.user,
    expiresIn: getAccessTokenExpiresIn(),
  });
});

router.get('/me', requireAuth(), (req: Request, res: Response) => {
  res.json({
    user: req.user,
    expiresIn: getAccessTokenExpiresIn(),
  });
});

export default router;
