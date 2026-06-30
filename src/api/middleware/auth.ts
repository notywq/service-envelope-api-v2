import { Request, Response, NextFunction } from 'express';
import jwt, { SignOptions } from 'jsonwebtoken';

export type ApiRole = 'super_admin' | 'admin' | 'requester' | 'orchestrator' | 'approver' | 'service';

export interface AuthenticatedUser {
  email: string;
  role: ApiRole;
  name?: string;
  clientId?: string;
  scopes?: string[];
  authType?: 'otp' | 'client_credentials';
  tokenType: 'access';
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

const DEV_JWT_SECRET = 'dev-only-service-envelope-jwt-secret-change-me';

function splitCsv(value?: string): string[] {
  return (value || '')
    .split(',')
    .map(part => part.trim())
    .filter(Boolean);
}
export function isAuthRequired(): boolean {
  if (process.env.AUTH_REQUIRED === 'true') {
    return true;
  }
  if (process.env.AUTH_REQUIRED === 'false') {
    return false;
  }
  return process.env.NODE_ENV === 'production';
}

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (process.env.NODE_ENV === 'production' && (!secret || secret.length < 32 || secret === 'secret-key')) {
    throw new Error('JWT_SECRET must be set to a strong value (32+ chars) in production');
  }
  return secret || DEV_JWT_SECRET;
}

export function getAccessTokenExpiresIn(): string {
  return process.env.JWT_ACCESS_TOKEN_EXPIRES_IN || '1h';
}

export function getAccessTokenExpiresInSeconds(): number {
  const raw = getAccessTokenExpiresIn().trim();
  const match = raw.match(/^(\d+)([smhd])?$/i);

  if (!match) {
    return 3600;
  }

  const value = Number(match[1]);
  const unit = (match[2] || 's').toLowerCase();

  switch (unit) {
    case 'd':
      return value * 24 * 60 * 60;
    case 'h':
      return value * 60 * 60;
    case 'm':
      return value * 60;
    case 's':
    default:
      return value;
  }
}

function getJwtOptions(): SignOptions {
  const options: SignOptions = {
    expiresIn: getAccessTokenExpiresIn() as SignOptions['expiresIn'],
  };

  if (process.env.JWT_ISSUER) {
    options.issuer = process.env.JWT_ISSUER;
  }
  if (process.env.JWT_AUDIENCE) {
    options.audience = process.env.JWT_AUDIENCE;
  }

  return options;
}

function getVerifyOptions(): jwt.VerifyOptions {
  const options: jwt.VerifyOptions = {};

  if (process.env.JWT_ISSUER) {
    options.issuer = process.env.JWT_ISSUER;
  }
  if (process.env.JWT_AUDIENCE) {
    options.audience = process.env.JWT_AUDIENCE;
  }

  return options;
}

export function issueAccessToken(user: Omit<AuthenticatedUser, 'tokenType'>): string {
  return jwt.sign(
    {
      sub: user.email,
      email: user.email,
      role: user.role,
      name: user.name,
      clientId: user.clientId,
      scopes: user.scopes,
      authType: user.authType,
      tokenType: 'access',
    },
    getJwtSecret(),
    getJwtOptions()
  );
}

export function verifyAccessToken(token: string): AuthenticatedUser {
  const decoded = jwt.verify(token, getJwtSecret(), getVerifyOptions()) as jwt.JwtPayload;

  if (decoded.tokenType !== 'access' || typeof decoded.email !== 'string') {
    throw new Error('Invalid access token payload');
  }

  return {
    email: decoded.email,
    role: (decoded.role as ApiRole) || 'requester',
    name: typeof decoded.name === 'string' ? decoded.name : undefined,
    clientId: typeof decoded.clientId === 'string' ? decoded.clientId : undefined,
    scopes: Array.isArray(decoded.scopes) ? decoded.scopes.filter(scope => typeof scope === 'string') : undefined,
    authType: decoded.authType === 'client_credentials' ? 'client_credentials' : 'otp',
    tokenType: 'access',
  };
}

function roleSatisfies(userRole: ApiRole, requiredRole: ApiRole): boolean {
  if (userRole === requiredRole) {
    return true;
  }

  if (userRole === 'super_admin') {
    return true;
  }

  if (requiredRole === 'orchestrator' && userRole === 'service') {
    return true;
  }

  if (requiredRole === 'service' && userRole === 'orchestrator') {
    return true;
  }

  return false;
}

function canAccessAuthenticatedApi(user: AuthenticatedUser, path: string, method: string): boolean {
  const normalizedPath = path.toLowerCase();
  const normalizedMethod = method.toUpperCase();

  if (user.role === 'super_admin') {
    return true;
  }

  if (user.role === 'admin') {
    return true;
  }

  if (user.role === 'orchestrator' || user.role === 'service') {
    return !normalizedPath.startsWith('/admin');
  }

  if (user.role === 'requester') {
    if (normalizedPath.startsWith('/admin')) {
      return false;
    }

    if (normalizedPath.startsWith('/services') && normalizedMethod === 'GET') {
      return true;
    }

    if (normalizedPath === '/requests' && normalizedMethod === 'POST') {
      return true;
    }

    if (/^\/requests\/[^/]+$/.test(normalizedPath) && normalizedMethod === 'GET') {
      return true;
    }

    if (/^\/requests\/[^/]+\/history$/.test(normalizedPath) && normalizedMethod === 'GET') {
      return true;
    }

    if (/^\/delivery\/[^/]+\/(details|method)$/.test(normalizedPath)) {
      return ['GET', 'POST'].includes(normalizedMethod);
    }

    if (/^\/payments\/[^/]+\/(complete|failed)$/.test(normalizedPath) && normalizedMethod === 'POST') {
      return true;
    }

    if (/^\/feedback\/[^/]+$/.test(normalizedPath) && normalizedMethod === 'GET') {
      return true;
    }

    return false;
  }

  return false;
}

function getRequiredClientScope(path: string, method: string): string | null {
  const normalizedPath = path.toLowerCase();
  const normalizedMethod = method.toUpperCase();

  if (normalizedPath.startsWith('/services')) {
    if (normalizedMethod === 'GET') {
      return 'services:read';
    }
    if (/^\/services\/[^/]+$/.test(normalizedPath) && normalizedMethod === 'DELETE') {
      return 'services:delete';
    }
  }

  if (normalizedPath === '/requests' && normalizedMethod === 'POST') {
    return 'requests:create';
  }
  if (normalizedPath === '/requests' && normalizedMethod === 'GET') {
    return 'requests:list';
  }
  if (/^\/requests\/[^/]+$/.test(normalizedPath) && normalizedMethod === 'GET') {
    return 'requests:read';
  }
  if (/^\/requests\/[^/]+\/history$/.test(normalizedPath) && normalizedMethod === 'GET') {
    return 'requests:history';
  }
  if (/^\/requests\/[^/]+\/resume$/.test(normalizedPath) && normalizedMethod === 'POST') {
    return 'requests:resume';
  }
  if (/^\/requests\/[^/]+$/.test(normalizedPath) && normalizedMethod === 'DELETE') {
    return 'requests:cancel';
  }

  if (/^\/delivery\/[^/]+(\/method)?$/.test(normalizedPath) && normalizedMethod === 'GET') {
    return 'delivery:read';
  }
  if (/^\/delivery\/[^/]+\/(details|method)$/.test(normalizedPath) && normalizedMethod === 'POST') {
    return 'delivery:update';
  }

  if (/^\/delivery-status\/[^/]+\/(history|current)$/.test(normalizedPath) && normalizedMethod === 'GET') {
    return 'delivery-status:read';
  }
  if (/^\/delivery-status\/[^/]+$/.test(normalizedPath) && normalizedMethod === 'POST') {
    return 'delivery-status:update';
  }

  if (/^\/payments\/[^/]+\/complete$/.test(normalizedPath) && normalizedMethod === 'POST') {
    return 'payments:complete';
  }
  if (/^\/webhooks\/[^/]+\/complete$/.test(normalizedPath) && normalizedMethod === 'POST') {
    return 'payments:complete';
  }
  if (/^\/payments\/[^/]+\/failed$/.test(normalizedPath) && normalizedMethod === 'POST') {
    return 'payments:fail';
  }
  if (/^\/webhooks\/[^/]+\/failed$/.test(normalizedPath) && normalizedMethod === 'POST') {
    return 'payments:fail';
  }
  if ((normalizedPath === '/payments/maya' || normalizedPath === '/webhooks/maya') && normalizedMethod === 'POST') {
    return 'payments:webhook';
  }

  if (/^\/feedback\/[^/]+$/.test(normalizedPath) && normalizedMethod === 'GET') {
    return 'feedback:read';
  }
  if (/^\/feedback\/[^/]+\/submit$/.test(normalizedPath) && normalizedMethod === 'POST') {
    return 'feedback:submit';
  }

  if (/^\/processing\/[^/]+(\/tasks\/[^/]+|\/summary)?$/.test(normalizedPath) && normalizedMethod === 'GET') {
    return 'processing:read';
  }

  return null;
}

function formatLogValue(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return 'n/a';
  }

  if (Array.isArray(value)) {
    return `[${value.map(formatLogValue).join(', ')}]`;
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  const text = String(value);
  return /\s/.test(text) ? JSON.stringify(text) : text;
}

function formatLogFields(fields: Record<string, unknown>): string {
  return Object.entries(fields)
    .map(([key, value]) => `${key}=${formatLogValue(value)}`)
    .join(' | ');
}

function logPermissionDenied(req: Request, details: Record<string, unknown>) {
  const reason = details.reason || 'unknown';
  const extraDetails = Object.fromEntries(
    Object.entries(details).filter(([key]) => key !== 'reason')
  );

  console.warn(`[API AUTH] denied ${req.method} ${req.originalUrl || req.path} | ${formatLogFields({
    reason,
    ...extraDetails,
    ip: req.ip,
    userAgent: req.headers['user-agent'] || '',
    at: new Date().toISOString(),
  })}`);
}

function logMachineAuthAccess(req: Request, user: AuthenticatedUser, requiredScope: string | null) {
  console.log(`[API AUTH] machine access ${req.method} ${req.originalUrl || req.path} | ${formatLogFields({
    clientId: user.clientId,
    role: user.role,
    requiredScope,
    grantedScopes: user.scopes || [],
    ip: req.ip,
    forwardedFor: req.headers['x-forwarded-for'] || '',
    userAgent: req.headers['user-agent'] || '',
    at: new Date().toISOString(),
  })}`);
}

export function getBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return null;
  }

  const [scheme, token] = authHeader.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) {
    return null;
  }

  return token;
}

export function requireAuth(options: { roles?: ApiRole[] } = {}) {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = getBearerToken(req);

    if (!token) {
      if (!isAuthRequired()) {
        return next();
      }
      logPermissionDenied(req, {
        reason: 'missing_bearer_token',
        requiredRoles: options.roles || [],
      });
      return res.status(401).json({ error: 'Bearer token required' });
    }

    try {
      const user = verifyAccessToken(token);
      if (options.roles?.length && !options.roles.some(role => roleSatisfies(user.role, role))) {
        logPermissionDenied(req, {
          reason: 'insufficient_role',
          email: user.email,
          role: user.role,
          requiredRoles: options.roles,
        });
        return res.status(403).json({ error: 'Insufficient permissions' });
      }
      req.user = user;
      return next();
    } catch {
      logPermissionDenied(req, {
        reason: 'invalid_or_expired_bearer_token',
        requiredRoles: options.roles || [],
      });
      return res.status(401).json({ error: 'Invalid or expired bearer token' });
    }
  };
}

export function isPublicApiPath(path: string, method: string): boolean {
  const normalizedPath = path.toLowerCase();
  const normalizedMethod = method.toUpperCase();

  if (normalizedPath === '/' && normalizedMethod === 'GET') {
    return true;
  }

  if (
    normalizedPath === '/auth/verify' ||
    normalizedPath === '/auth/me' ||
    normalizedPath === '/otp/flush'
  ) {
    return false;
  }

  if (normalizedPath.startsWith('/auth/') || normalizedPath.startsWith('/otp/')) {
    return true;
  }

  if (normalizedPath.startsWith('/mock/')) {
    return true;
  }

  if (/^\/approvals\/[^/]+$/.test(normalizedPath) && normalizedMethod === 'GET') {
    return true;
  }

  if (/^\/approvals\/[^/]+\/request$/.test(normalizedPath) && normalizedMethod === 'GET') {
    return true;
  }

  if (/^\/approvals\/[^/]+\/(approve|deny)$/.test(normalizedPath) && normalizedMethod === 'POST') {
    return true;
  }

  if (/^\/feedback\/token\/[^/]+$/.test(normalizedPath) && normalizedMethod === 'GET') {
    return true;
  }

  if (/^\/feedback\/token\/[^/]+\/submit$/.test(normalizedPath) && normalizedMethod === 'POST') {
    return true;
  }

  return false;
}

export function requireApiAuth(req: Request, res: Response, next: NextFunction) {
  if (isPublicApiPath(req.path, req.method)) {
    return next();
  }

  const token = getBearerToken(req);

  if (!token) {
    if (!isAuthRequired()) {
      return next();
    }
    logPermissionDenied(req, {
      reason: 'missing_bearer_token',
    });
    return res.status(401).json({ error: 'Bearer token required' });
  }

  try {
    const user = verifyAccessToken(token);
    if (!canAccessAuthenticatedApi(user, req.path, req.method)) {
      logPermissionDenied(req, {
        reason: 'route_not_allowed_for_role',
        email: user.email,
        role: user.role,
      });
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    if (user.authType === 'client_credentials') {
      const requiredScope = getRequiredClientScope(req.path, req.method);
      if (!requiredScope || !user.scopes?.includes(requiredScope)) {
        logPermissionDenied(req, {
          reason: requiredScope ? 'missing_client_scope' : 'route_not_scoped_for_client_credentials',
          email: user.email,
          role: user.role,
          clientId: user.clientId,
          requiredScope,
        });
        return res.status(403).json({
          error: 'Insufficient client scope',
          requiredScope,
        });
      }
      logMachineAuthAccess(req, user, requiredScope);
    }
    req.user = user;
    return next();
  } catch {
    logPermissionDenied(req, {
      reason: 'invalid_or_expired_bearer_token',
    });
    return res.status(401).json({ error: 'Invalid or expired bearer token' });
  }
}

export function validateAuthConfiguration(): void {
  if (!isAuthRequired()) {
    return;
  }

  getJwtSecret();
}
