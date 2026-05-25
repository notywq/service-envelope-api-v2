/**
 * Payments Routes
 * Handles payment completion via UI callback or Maya webhook
 */

import { Router, Request, Response } from 'express';
import { appContext } from '../server.js';
import { ServiceRequest } from '../../types/envelope.types.js';

const router = Router();

/**
 * Helper function to send payment confirmation email to requestor
 */
async function sendPaymentConfirmationEmail(request: ServiceRequest, transactionId: string, amount: number, method: string) {
  try {
    const requestorEmail = request.envelopes.request.parameters?.initiatorEmail;
    const requestorName = request.envelopes.request.parameters?.initiatorName || 'Student';
    
    if (!requestorEmail) {
      appContext.logger.warn(`⚠️  No requestor email found for request ${request.id}`);
      return;
    }

    appContext.logger.info(`📧 Preparing payment confirmation email for ${requestorEmail}`);

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background-color: #f5f5f5; padding: 20px; border-radius: 5px;">
          <h2 style="color: #003a70;">✅ Payment Received - Receipt</h2>
          
          <p>Hello ${requestorName},</p>
          <p>Thank you! We have successfully received your payment for your service request.</p>
          
          <div style="background-color: white; padding: 15px; border-left: 4px solid #28a745; margin: 20px 0;">
            <p><strong>Receipt Details:</strong></p>
            <p style="margin: 10px 0;"><strong>Request ID:</strong> ${request.id}</p>
            <p style="margin: 10px 0;"><strong>Transaction ID:</strong> ${transactionId}</p>
            <p style="margin: 10px 0;"><strong>Amount Paid:</strong> ₱${amount.toFixed(2)}</p>
            <p style="margin: 10px 0;"><strong>Payment Method:</strong> ${method}</p>
            <p style="margin: 10px 0;"><strong>Date/Time:</strong> ${new Date().toLocaleString()}</p>
            <p style="margin: 10px 0;"><strong>Status:</strong> <span style="color: #28a745; font-weight: bold;">✅ CONFIRMED</span></p>
          </div>

          <p>Your request is now being processed. You will receive updates via email as it progresses through our system.</p>
          
          <p style="font-size: 13px; color: #666; margin-top: 20px;">
            Please keep this receipt for your records. If you have any questions, please contact the registrar's office.
          </p>
          
          <p style="font-size: 11px; color: #999; margin-top: 30px; border-top: 1px solid #ddd; padding-top: 15px;">
            This is an automated receipt. Please do not reply to this email.
          </p>
        </div>
      </div>
    `;

    // Send email
    await appContext.emailService.sendEmail({
      to: requestorEmail,
      subject: `💳 Payment Received - Receipt for Request ${request.id}`,
      html,
    });
    appContext.logger.info(`✅ Payment confirmation email sent to ${requestorEmail}`);

  } catch (error) {
    appContext.logger.error(`Failed to send payment confirmation email: ${(error as Error).message}`);
  }
}

/**
 * POST /api/payments/:requestId/complete
 * Mark payment as complete (called from Phase 2 UI after user completes Maya payment)
 * 
 * Request body:
 * {
 *   transactionId: string (Maya transaction ID)
 *   amount: number
 *   method: "maya" | "credit_card" | etc
 *   reference: string (receipt/reference number)
 *   metadata?: Record<string, any> (additional info)
 * }
 */
router.post('/:requestId/complete', async (req: Request, res: Response) => {
  try {
    const { requestId } = req.params;
    const { transactionId, amount, method, reference, metadata } = req.body;

    // Validate required fields
    if (!transactionId || !amount) {
      return res.status(400).json({
        error: 'Missing required fields: transactionId, amount',
      });
    }

    // Load request
    const request = await appContext.stateManager.loadRequest(requestId);
    if (!request) {
      return res.status(404).json({ error: `Request ${requestId} not found` });
    }

    appContext.logger.info(`💳 Payment completed for request ${requestId}: Transaction ${transactionId}`);

    // Update payment envelope
    const paymentEnvelope = request.envelopes.payment;
    paymentEnvelope.status = 'completed';
    paymentEnvelope.transactionId = transactionId;
    paymentEnvelope.paymentGatewayResponse = {
      transactionId,
      amount,
      method: method || 'credit_card',
      reference,
      timestamp: new Date().toISOString(),
      metadata: metadata || {}
    };
    paymentEnvelope.timestamp = new Date().toISOString();

    // Update overall request status
    request.overallStatus = 'processing';
    request.lastUpdated = new Date().toISOString();

    // Add history entry
    request.history.push({
      status: 'payment_completed',
      timestamp: new Date().toISOString(),
      envelope: 'payment',
      notes: `Payment completed via ${method || 'credit_card'}. Transaction: ${transactionId}`,
    });

    // Save request
    await appContext.stateManager.saveRequest(request);

    appContext.logger.info(`✅ Payment marked complete for request ${requestId} - resuming pipeline`);
    
    // Send payment confirmation email to requestor
    await sendPaymentConfirmationEmail(request, transactionId, amount, method || 'credit_card');

    // Resume orchestration to process next envelopes
    appContext.orchestrator.processRequest(request).subscribe({
      next: (result) => {
        appContext.logger.info(`📊 Request resumed after payment: ${result.id} -> ${result.overallStatus}`);
      },
      error: (err) => {
        appContext.logger.error(`❌ Error processing request after payment: ${err.message}`);
      },
    });

    res.json({
      requestId,
      status: 'completed',
      message: 'Payment recorded and processing resumed',
      transactionId,
      nextStatus: 'processing',
    });
  } catch (error) {
    appContext.logger.error('Error completing payment:', error);
    res.status(500).json({ error: 'Failed to complete payment' });
  }
});

/**
 * POST /api/payments/:requestId/failed
 * Mark payment as failed (called from Phase 2 UI if Maya payment fails)
 * 
 * Request body:
 * {
 *   reason: string (error reason)
 *   errorCode?: string (Maya error code)
 *   metadata?: Record<string, any>
 * }
 */
router.post('/:requestId/failed', async (req: Request, res: Response) => {
  try {
    const { requestId } = req.params;
    const { reason, errorCode, metadata } = req.body;

    if (!reason) {
      return res.status(400).json({
        error: 'Missing required field: reason',
      });
    }

    const request = await appContext.stateManager.loadRequest(requestId);
    if (!request) {
      return res.status(404).json({ error: `Request ${requestId} not found` });
    }

    appContext.logger.error(`❌ Payment failed for request ${requestId}: ${reason} (${errorCode || 'unknown'})`);

    // Update payment envelope
    const paymentEnvelope = request.envelopes.payment;
    paymentEnvelope.status = 'failed';
    paymentEnvelope.paymentGatewayResponse = {
      status: 'FAILED',
      errorCode: errorCode || 'UNKNOWN',
      reason,
      timestamp: new Date().toISOString(),
      metadata: metadata || {}
    };
    paymentEnvelope.timestamp = new Date().toISOString();

    // Keep overall status as pending_payment so user can retry
    request.overallStatus = 'pending_payment';
    request.lastUpdated = new Date().toISOString();

    // Add history entry
    request.history.push({
      status: 'payment_failed',
      timestamp: new Date().toISOString(),
      envelope: 'payment',
      notes: `Payment failed: ${reason}${errorCode ? ` (Code: ${errorCode})` : ''}`,
    });

    // Save request
    await appContext.stateManager.saveRequest(request);

    res.json({
      requestId,
      status: 'failed',
      message: 'Payment failed - user can retry',
      reason,
      nextStatus: 'pending_payment',
    });
  } catch (error) {
    appContext.logger.error('Error handling payment failure:', error);
    res.status(500).json({ error: 'Failed to record payment failure' });
  }
});

/**
 * POST /api/webhooks/maya
 * Maya payment gateway webhook callback
 * Called by Maya after payment is processed
 * 
 * Expected payload from Maya (varies by API version):
 * {
 *   checkoutId?: string
 *   requestReferenceNumber: string (our request ID embedded in reference)
 *   transactionId: string
 *   status: "SUCCESS" | "FAILURE" | "PENDING"
 *   amount: number
 *   currency: string
 *   timestamp: string
 * }
 */
router.post('/maya', async (req: Request, res: Response) => {
  try {
    const payload = req.body;
    appContext.logger.info(`🔔 Maya webhook received: ${JSON.stringify(payload)}`);

    // Extract request ID from reference number or custom field
    // This depends on how you format the reference when creating the payment
    let requestId = payload.requestReferenceNumber || payload.customField?.requestId;

    if (!requestId) {
      appContext.logger.warn(`⚠️  Maya webhook: Could not extract request ID from payload`);
      return res.status(400).json({ error: 'Could not extract request ID from webhook' });
    }

    // Load request
    const request = await appContext.stateManager.loadRequest(requestId);
    if (!request) {
      appContext.logger.warn(`⚠️  Maya webhook: Request ${requestId} not found`);
      return res.status(404).json({ error: `Request ${requestId} not found` });
    }

    // Process based on Maya status
    if (payload.status === 'SUCCESS' || payload.status === 'COMPLETED') {
      appContext.logger.info(`✅ Maya webhook: Payment successful for request ${requestId}`);

      // Update payment envelope
      const paymentEnvelope = request.envelopes.payment;
      paymentEnvelope.status = 'completed';
      paymentEnvelope.transactionId = payload.transactionId;
      paymentEnvelope.paymentGatewayResponse = {
        transactionId: payload.transactionId,
        amount: payload.amount,
        currency: payload.currency,
        status: 'COMPLETED',
        reference: payload.requestReferenceNumber,
        webhookTimestamp: new Date().toISOString(),
        originalPayload: payload
      };
      paymentEnvelope.timestamp = new Date().toISOString();

      request.overallStatus = 'processing';
      request.lastUpdated = new Date().toISOString();

      request.history.push({
        status: 'payment_completed_webhook',
        timestamp: new Date().toISOString(),
        envelope: 'payment',
        notes: `Payment verified via Maya webhook. Transaction: ${payload.transactionId}`,
      });

      await appContext.stateManager.saveRequest(request);

      // Resume orchestration
      appContext.orchestrator.processRequest(request).subscribe({
        next: (result) => {
          appContext.logger.info(`📊 Request resumed after Maya payment: ${result.id} -> ${result.overallStatus}`);
        },
        error: (err) => {
          appContext.logger.error(`❌ Error processing request after Maya payment: ${err.message}`);
        },
      });

    } else if (payload.status === 'FAILURE' || payload.status === 'FAILED') {
      appContext.logger.error(`❌ Maya webhook: Payment failed for request ${requestId}`);

      const paymentEnvelope = request.envelopes.payment;
      paymentEnvelope.status = 'failed';
      paymentEnvelope.paymentGatewayResponse = {
        status: 'FAILED',
        transactionId: payload.transactionId,
        amount: payload.amount,
        currency: payload.currency,
        webhookTimestamp: new Date().toISOString(),
        originalPayload: payload
      };
      paymentEnvelope.timestamp = new Date().toISOString();

      request.overallStatus = 'pending_payment';
      request.lastUpdated = new Date().toISOString();

      request.history.push({
        status: 'payment_failed_webhook',
        timestamp: new Date().toISOString(),
        envelope: 'payment',
        notes: `Payment failed via Maya webhook. Transaction: ${payload.transactionId}`,
      });

      await appContext.stateManager.saveRequest(request);

    } else if (payload.status === 'PENDING') {
      appContext.logger.info(`⏳ Maya webhook: Payment pending for request ${requestId}`);
      // Keep as pending_external - user will be notified

    } else {
      appContext.logger.warn(`⚠️  Maya webhook: Unknown status "${payload.status}" for request ${requestId}`);
    }

    // Return 200 OK to confirm webhook received
    res.json({
      success: true,
      requestId,
      message: 'Webhook processed',
      status: payload.status,
    });

  } catch (error) {
    appContext.logger.error('Error processing Maya webhook:', error);
    // Return 200 to prevent Maya from retrying, but log the error
    res.status(500).json({ error: 'Failed to process webhook', details: String(error) });
  }
});

export default router;
