/**
 * Feedback Routes
 * Handles feedback submission and completion
 */

import { Router, Request, Response } from 'express';
import { appContext } from '../server.js';
import { ServiceRequest } from '../../types/envelope.types.js';

const router = Router();

type FeedbackTokenRecord = {
  token: string;
  requestId: string;
  expiresAt: Date | string;
  used: boolean;
  createdAt?: Date | string;
  feedback?: unknown;
};

function normalizeTokenDate(value?: Date | string): string | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function buildTokenStatus(tokenData: FeedbackTokenRecord) {
  const expiresAtIso = normalizeTokenDate(tokenData.expiresAt);
  const isExpired = expiresAtIso ? new Date(expiresAtIso).getTime() < Date.now() : false;

  return {
    token: tokenData.token,
    requestId: tokenData.requestId,
    isUsed: Boolean(tokenData.used),
    isExpired,
    expiresAt: expiresAtIso,
    submittedFeedback: tokenData.feedback || null,
  };
}

async function submitFeedbackForRequest(
  request: ServiceRequest,
  ratings: Record<string, number> | undefined,
  comments: string | undefined,
  tokenForConsumption: string
): Promise<void> {
  request.envelopes.feedback.feedback = {
    ratings: ratings || {},
    comments: comments || '',
    submittedAt: new Date().toISOString(),
  };

  request.envelopes.feedback.timestamp = new Date().toISOString();
  request.overallStatus = 'pending_feedback';
  request.lastUpdated = new Date().toISOString();

  await appContext.stateManager.saveRequest(request);

  await (appContext.stateManager as any).markFeedbackTokenAsUsed(
    tokenForConsumption,
    request.envelopes.feedback.feedback
  );
}

async function resumeOrchestration(request: ServiceRequest, requestId: string): Promise<void> {
  const lock = await appContext.requestProcessingLock.acquire(requestId);

  appContext.orchestrator.processRequest(request).subscribe({
    next: (result) => {
      appContext.logger.info(`📊 Request auto-resumed after feedback: ${result.id} -> ${result.overallStatus}`);
    },
    error: (err) => {
      appContext.logger.error(`❌ Error in auto-resume: ${err.message}`);
      lock.release();
    },
    complete: () => {
      lock.release();
      appContext.logger.info('   ℹ️  Orchestrator completed, lock released');
    },
  });
}

/**
 * GET /api/feedback/token/:token
 * Resolve feedback page state by token
 */
router.get('/token/:token', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const tokenData = await (appContext.stateManager as any).getFeedbackToken(token) as FeedbackTokenRecord | null;

    if (!tokenData) {
      return res.status(404).json({ error: 'Feedback token not found' });
    }

    const tokenStatus = buildTokenStatus(tokenData);
    const request = await appContext.stateManager.loadRequest(tokenData.requestId);

    if (!request) {
      return res.status(404).json({ error: `Request ${tokenData.requestId} not found`, tokenStatus });
    }

    if (tokenStatus.isExpired) {
      return res.status(410).json({ error: 'Feedback token has expired', tokenStatus });
    }

    const feedback = request.envelopes.feedback;
    return res.json({
      requestId: request.id,
      token,
      status: feedback.status,
      feedbackLink: feedback.feedbackLink,
      expiresAt: feedback.expiresAt,
      feedback: feedback.feedback,
      tokenStatus,
    });
  } catch (error) {
    appContext.logger.error(`Error fetching feedback by token: ${error}`);
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * POST /api/feedback/token/:token/submit
 * Submit feedback by token
 */
router.post('/token/:token/submit', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const { ratings, comments } = req.body;

    const tokenData = await (appContext.stateManager as any).getFeedbackToken(token) as FeedbackTokenRecord | null;
    if (!tokenData) {
      return res.status(404).json({ error: 'Feedback token not found' });
    }

    const tokenStatus = buildTokenStatus(tokenData);
    if (tokenStatus.isExpired) {
      return res.status(410).json({ error: 'Feedback token has expired', tokenStatus });
    }

    if (tokenStatus.isUsed) {
      return res.status(409).json({ error: 'Feedback token has already been used', tokenStatus });
    }

    const request = await appContext.stateManager.loadRequest(tokenData.requestId);
    if (!request) {
      return res.status(404).json({ error: `Request ${tokenData.requestId} not found` });
    }

    if (!request.envelopes.feedback) {
      return res.status(400).json({ error: 'Feedback envelope not found for this request' });
    }

    if (request.envelopes.feedback.status !== 'pending_external') {
      return res.status(400).json({
        error: `Cannot submit feedback when envelope status is ${request.envelopes.feedback.status}`,
      });
    }

    await submitFeedbackForRequest(request, ratings, comments, token);
    appContext.logger.info(`✅ Feedback submitted for request ${tokenData.requestId} using token ${token}.`);

    await resumeOrchestration(request, tokenData.requestId);

    res.json({
      status: 'success',
      message: 'Feedback submitted successfully and processing resumed.',
      requestId: tokenData.requestId,
      token,
      feedbackReceivedAt: new Date().toISOString(),
    });
  } catch (error) {
    appContext.logger.error(`Error submitting feedback by token: ${error}`);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Legacy feedback routes are intentionally unsupported.
// Keep explicit handlers so outdated clients fail fast with a clear migration target.
router.get('/:requestId', (_req: Request, res: Response) => {
  return res.status(410).json({
    error: 'Legacy feedback route is no longer supported. Use token routes only.',
    canonicalRoutes: {
      get: '/api/feedback/token/:token',
      submit: '/api/feedback/token/:token/submit',
    },
  });
});

router.post('/:requestId/submit', (_req: Request, res: Response) => {
  return res.status(410).json({
    error: 'Legacy feedback route is no longer supported. Use token routes only.',
    canonicalRoutes: {
      get: '/api/feedback/token/:token',
      submit: '/api/feedback/token/:token/submit',
    },
  });
});

export default router;
