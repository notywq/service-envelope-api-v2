/**
 * Authentication Routes
 * Handles user login and JWT token generation
 */

import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { appContext } from '../server.js';

const router = Router();

interface LoginRequest {
  email: string;
  password: string;
}

// Mock user database - in production, use real database
const MOCK_USERS = [
  { email: 'admin@mapua.edu.ph', password: 'admin123', role: 'admin', name: 'Admin User' },
  { email: 'approver@mapua.edu.ph', password: 'approver123', role: 'approver', name: 'Registrar' },
  { email: 'requester@mapua.edu.ph', password: 'requester123', role: 'requester', name: 'Student' },
];

/**
 * POST /api/auth/login
 * Login with email and password, return JWT token
 */
router.post('/login', (req: Request, res: Response) => {
  try {
    const { email, password } = req.body as LoginRequest;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const user = MOCK_USERS.find(u => u.email === email && u.password === password);

    if (!user) {
      appContext.logger.warn(`⚠️  Failed login attempt for ${email}`);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { email: user.email, role: user.role, name: user.name },
      process.env.JWT_SECRET || 'secret-key',
      { expiresIn: '24h' }
    );

    appContext.logger.info(`✅ User logged in: ${user.email}`);

    res.json({
      token,
      user: {
        email: user.email,
        name: user.name,
        role: user.role,
      },
      expiresIn: '24h',
    });
  } catch (error) {
    appContext.logger.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /api/auth/verify
 * Verify JWT token is valid
 */
router.post('/verify', (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];

    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret-key');
    res.json({ valid: true, user: decoded });
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

export default router;
