/**
 * Authentication Routes
 * OTP verification issues bearer tokens. These routes inspect or validate tokens.
 */

import { Router, Request, Response } from 'express';
import { appContext } from '../server.js';
import {
  ApiRole,
  getAccessTokenExpiresIn,
  getAccessTokenExpiresInSeconds,
  issueAccessToken,
  requireAuth,
} from '../middleware/auth.js';
import { verifyApiClientSecret } from '../../utils/api-client-secret.js';

const router = Router();

function normalizeClientRole(role: unknown): Extract<ApiRole, 'orchestrator' | 'service'> {
  return role === 'service' ? 'service' : 'orchestrator';
}

function logMachineTokenIssued(req: Request, client: any, scopes: string[]) {
  console.log(JSON.stringify({
    level: 'info',
    event: 'machine_auth_token_issued',
    clientId: client.clientId,
    name: client.name,
    role: client.role,
    scopes,
    ip: req.ip,
    forwardedFor: req.headers['x-forwarded-for'] || '',
    userAgent: req.headers['user-agent'] || '',
    timestamp: new Date().toISOString(),
  }));
}

function getBasicClientCredentials(req: Request): { clientId: string; clientSecret: string } | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.toLowerCase().startsWith('basic ')) {
    return null;
  }

  try {
    const decoded = Buffer.from(authHeader.slice('basic '.length).trim(), 'base64').toString('utf8');
    const separatorIndex = decoded.indexOf(':');
    if (separatorIndex < 0) {
      return null;
    }

    return {
      clientId: decodeURIComponent(decoded.slice(0, separatorIndex)),
      clientSecret: decodeURIComponent(decoded.slice(separatorIndex + 1)),
    };
  } catch {
    return null;
  }
}

function normalizeRequestedScopes(scope: unknown): string[] {
  if (typeof scope !== 'string') {
    return [];
  }

  return [...new Set(scope
    .split(/\s+/)
    .map(part => part.trim())
    .filter(Boolean))];
}

router.post('/login', (_req: Request, res: Response) => {
  res.status(410).json({
    error: 'Password login is disabled. Use POST /api/OTP/send and POST /api/OTP/verify.',
  });
});

router.post('/client-token', async (req: Request, res: Response) => {
  try {
    const basicCredentials = getBasicClientCredentials(req);
    const grantType = req.body?.grant_type || req.body?.grantType || 'client_credentials';
    const clientId = typeof req.body?.clientId === 'string'
      ? req.body.clientId.trim()
      : typeof req.body?.client_id === 'string'
        ? req.body.client_id.trim()
        : basicCredentials?.clientId?.trim() || '';
    const clientSecret = typeof req.body?.clientSecret === 'string'
      ? req.body.clientSecret
      : typeof req.body?.client_secret === 'string'
        ? req.body.client_secret
        : basicCredentials?.clientSecret || '';

    if (grantType !== 'client_credentials') {
      return res.status(400).json({ error: 'Unsupported grant_type' });
    }

    if (!clientId || !clientSecret) {
      return res.status(400).json({ error: 'clientId and clientSecret are required' });
    }

    const client = await (appContext.stateManager as any).getApiClientById(clientId);
    if (!client || client.isActive === false) {
      return res.status(401).json({ error: 'Invalid client credentials' });
    }

    if (!verifyApiClientSecret(clientSecret, client.secretSalt, client.secretHash)) {
      return res.status(401).json({ error: 'Invalid client credentials' });
    }

    await (appContext.stateManager as any).markApiClientUsed(clientId);

    const role = normalizeClientRole(client.role);
    const allowedScopes = Array.isArray(client.scopes)
      ? client.scopes.filter((scope: unknown): scope is string => typeof scope === 'string')
      : [];
    const requestedScopes = normalizeRequestedScopes(req.body?.scope);
    const invalidRequestedScopes = requestedScopes.filter(scope => !allowedScopes.includes(scope));

    if (invalidRequestedScopes.length > 0) {
      return res.status(403).json({
        error: 'invalid_scope',
        error_description: `Client is not allowed to request scopes: ${invalidRequestedScopes.join(', ')}`,
      });
    }

    const scopes = requestedScopes.length > 0 ? requestedScopes : allowedScopes;
    const accessToken = issueAccessToken({
      email: `${clientId}@api-client.local`,
      role,
      name: client.name,
      clientId,
      scopes,
      authType: 'client_credentials',
    });

    logMachineTokenIssued(req, { ...client, role }, scopes);

    res.json({
      accessToken,
      tokenType: 'Bearer',
      expiresIn: getAccessTokenExpiresIn(),
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: getAccessTokenExpiresInSeconds(),
      scope: scopes.join(' '),
      client: {
        clientId,
        name: client.name,
        role,
        scopes,
      },
    });
  } catch (error) {
    appContext.logger.error('[AUTH] Client credentials token error:', error);
    res.status(500).json({ error: 'Failed to issue client token' });
  }
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
