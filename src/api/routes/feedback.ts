/**
 * Feedback Routes
 * Handles feedback submission and completion
 */

import { Router, Request, Response } from 'express';
import { appContext } from '../server.js';
import { ServiceRequest } from '../../types/envelope.types.js';

const router = Router();

/**
 * POST /api/requests/:requestId/feedback/submit
 * Submit feedback for a completed request
 * Body: { ratings: {question1: number, ...}, comments: string }
 */
router.post('/:requestId/submit', async (req: Request, res: Response) => {
  try {
    const { requestId } = req.params;
    const { ratings, comments } = req.body;

    // Load request
    const request = await appContext.stateManager.loadRequest(requestId);
    if (!request) {
      return res.status(404).json({ error: `Request ${requestId} not found` });
    }

    // Verify feedback envelope exists and is pending
    if (!request.envelopes.feedback) {
      return res.status(400).json({ error: 'Feedback envelope not found for this request' });
    }

    if (request.envelopes.feedback.status !== 'pending_external') {
      return res.status(400).json({ 
        error: `Cannot submit feedback when envelope status is ${request.envelopes.feedback.status}` 
      });
    }

    // Verify feedback token if provided
    if (request.envelopes.feedback.feedbackToken && req.body.token) {
      const tokenValid = await (appContext.stateManager as any).verifyFeedbackToken(
        req.body.token,
        requestId
      );
      if (!tokenValid) {
        return res.status(401).json({ error: 'Invalid or expired feedback token' });
      }
    }

    // Store feedback
    request.envelopes.feedback.feedback = {
      ratings: ratings || {},
      comments: comments || '',
      submittedAt: new Date().toISOString(),
    };

    // Mark feedback as completed
    request.envelopes.feedback.status = 'completed';
    request.envelopes.feedback.timestamp = new Date().toISOString();

    // Update overall request status
    request.overallStatus = 'pending_feedback';
    request.lastUpdated = new Date().toISOString();

    // Save updated request
    await appContext.stateManager.saveRequest(request);

    appContext.logger.info(
      `✅ Feedback submitted for request ${requestId}.`
    );

    // Acquire lock and auto-resume orchestrator
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
        appContext.logger.info(`   ℹ️  Orchestrator completed, lock released`);
      },
    });

    res.json({
      status: 'success',
      message: 'Feedback submitted successfully and processing resumed.',
      requestId,
      feedbackReceivedAt: new Date().toISOString(),
    });
  } catch (error) {
    appContext.logger.error(`Error submitting feedback: ${error}`);
    res.status(500).json({ error: (error as Error).message });
  }
});

/**
 * GET /api/requests/:requestId/feedback
 * Get feedback status and link
 */
router.get('/:requestId', async (req: Request, res: Response) => {
  try {
    const { requestId } = req.params;

    const request = await appContext.stateManager.loadRequest(requestId);
    if (!request) {
      return res.status(404).json({ error: `Request ${requestId} not found` });
    }

    const feedback = request.envelopes.feedback;
    res.json({
      requestId,
      status: feedback.status,
      feedbackLink: feedback.feedbackLink,
      expiresAt: feedback.expiresAt,
      feedback: feedback.feedback,
    });
  } catch (error) {
    appContext.logger.error(`Error fetching feedback: ${error}`);
    res.status(500).json({ error: (error as Error).message });
  }
});

export default router;
