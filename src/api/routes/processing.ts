/**
 * Processing Routes
 * Handles processing task execution status and monitoring
 */

import { Router, Request, Response } from 'express';
import { appContext } from '../server.js';

const router = Router();

/**
 * GET /api/requests/:requestId/processing
 * Get detailed processing status and task execution details
 */
router.get('/:requestId', async (req: Request, res: Response) => {
  try {
    const request = await appContext.stateManager.loadRequest(req.params.requestId);
    
    if (!request) {
      return res.status(404).json({ error: `Request ${req.params.requestId} not found` });
    }

    const processing = request.envelopes.processing;

    res.json({
      requestId: request.id,
      status: processing.status,
      currentTask: processing.currentTask,
      totalTasks: processing.tasks.length,
      completedTasks: processing.tasks.filter((t: any) => t.status === 'completed').length,
      failedTasks: processing.tasks.filter((t: any) => t.status === 'failed').length,
      pendingTasks: processing.tasks.filter((t: any) => t.status === 'pending' || !t.status).length,
      inProgressTasks: processing.tasks.filter((t: any) => t.status === 'in_progress').length,
      stopOnFailure: processing.stopOnFailure,
      tasks: processing.tasks.map((t: any) => ({
        name: t.name,
        method: t.method,
        url: t.url,
        status: t.status || 'pending',
        responseStatus: t.responseStatus,
        responseError: t.responseError,
      })),
      emailStatus: {
        startEmailSent: !!processing.startEmailSentAt,
        startEmailSentAt: processing.startEmailSentAt,
        endEmailSent: !!processing.endEmailSentAt,
        endEmailSentAt: processing.endEmailSentAt,
      },
      timestamps: {
        created: processing.timestamp,
        started: processing.startEmailSentAt,
        completed: processing.endEmailSentAt,
      }
    });
  } catch (error) {
    appContext.logger.error(`Error fetching processing status: ${error}`);
    res.status(500).json({ error: `Failed to fetch processing status: ${(error as Error).message}` });
  }
});

/**
 * GET /api/requests/:requestId/processing/tasks/:taskName
 * Get detailed info for a specific task including request/response data
 */
router.get('/:requestId/tasks/:taskName', async (req: Request, res: Response) => {
  try {
    const request = await appContext.stateManager.loadRequest(req.params.requestId);
    
    if (!request) {
      return res.status(404).json({ error: `Request ${req.params.requestId} not found` });
    }

    const task = request.envelopes.processing.tasks.find(
      (t: any) => t.name === req.params.taskName
    );

    if (!task) {
      return res.status(404).json({
        error: `Task "${req.params.taskName}" not found in request ${req.params.requestId}`,
      });
    }

    // Find task index for progress info
    const taskIndex = request.envelopes.processing.tasks.indexOf(task);
    const totalTasks = request.envelopes.processing.tasks.length;

    res.json({
      name: task.name,
      method: task.method,
      url: task.url,
      status: task.status || 'pending',
      progress: {
        taskNumber: taskIndex + 1,
        totalTasks: totalTasks,
        percentComplete: Math.round(((taskIndex + 1) / totalTasks) * 100),
      },
      request: {
        method: task.method,
        url: task.url,
        headers: task.headers || {},
        payload: task.payload,
        queryParams: task.queryParams || {},
        timeout: task.timeout || 30000,
        retries: task.retries || 3,
        successCodes: task.successCodes || [200, 201, 204],
      },
      response: {
        statusCode: task.responseStatus,
        data: task.responseData,
        error: task.responseError,
      },
      metadata: {
        configuration: {
          stopOnFailureEnabled: request.envelopes.processing.stopOnFailure,
        },
        request: {
          id: request.id,
          type: request.type,
        },
      },
    });
  } catch (error) {
    appContext.logger.error(`Error fetching task details: ${error}`);
    res.status(500).json({ error: `Failed to fetch task details: ${(error as Error).message}` });
  }
});

/**
 * GET /api/requests/:requestId/processing/summary
 * Get high-level summary of processing progress (for dashboards)
 */
router.get('/:requestId/summary', async (req: Request, res: Response) => {
  try {
    const request = await appContext.stateManager.loadRequest(req.params.requestId);
    
    if (!request) {
      return res.status(404).json({ error: `Request ${req.params.requestId} not found` });
    }

    const processing = request.envelopes.processing;
    const totalTasks = processing.tasks.length;
    const completedTasks = processing.tasks.filter((t: any) => t.status === 'completed').length;
    const failedTasks = processing.tasks.filter((t: any) => t.status === 'failed').length;
    const progressPercentage = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    res.json({
      requestId: request.id,
      processingStatus: processing.status,
      progress: {
        completedTasks,
        failedTasks,
        totalTasks,
        percentComplete: progressPercentage,
      },
      currentTask: processing.currentTask,
      hasErrors: failedTasks > 0,
      stopOnFailureEnabled: processing.stopOnFailure,
      emailNotifications: {
        startSent: !!processing.startEmailSentAt,
        endSent: !!processing.endEmailSentAt,
      },
      recommendation:
        processing.status === 'failed' && processing.stopOnFailure
          ? `Processing halted. Failed task: ${processing.tasks.find((t: any) => t.status === 'failed')?.name}. Review error and retry.`
          : processing.status === 'in_progress'
          ? `Processing in progress: ${processing.currentTask} (${completedTasks}/${totalTasks} completed)`
          : processing.status === 'completed'
          ? 'All tasks completed successfully!'
          : null,
    });
  } catch (error) {
    appContext.logger.error(`Error fetching processing summary: ${error}`);
    res.status(500).json({ error: `Failed to fetch processing summary: ${(error as Error).message}` });
  }
});

export default router;
