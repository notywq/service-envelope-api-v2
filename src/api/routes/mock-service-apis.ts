/**
 * Mock Service APIs for Testing
 * Simulates external service endpoints that the orchestrator calls during processing envelope
 * Returns success responses for comprehensive-student-document service
 */

import { Router, Request, Response } from 'express';
import { appContext } from '../server.js';

const router = Router();

/**
 * POST /api/mock/students/verify
 * Mock SIS API endpoint - Verify student records exist
 * Called by processing task: "Verify Student Records"
 */
router.post('/students/verify', (req: Request, res: Response) => {
  try {
    const { studentId, firstName, lastName } = req.body;

    appContext.logger.info(
      `[MOCK-SIS-API] ✅ Verifying student: ${studentId} (${firstName} ${lastName})`
    );

    // Return success response
    res.status(200).json({
      success: true,
      studentId,
      firstName,
      lastName,
      status: 'active',
      verified: true,
      verifiedAt: new Date().toISOString(),
      message: 'Student record verified successfully',
    });
  } catch (error) {
    appContext.logger.error('[MOCK-SIS-API] Error verifying student:', error);
    res.status(500).json({ error: 'Failed to verify student' });
  }
});

/**
 * POST /api/mock/documents/generate-record
 * Mock Registry API endpoint - Generate academic record document
 * Called by processing task: "Generate Academic Record"
 */
router.post('/documents/generate-record', (req: Request, res: Response) => {
  try {
    const { studentId, documentType, numberOfCopies } = req.body;

    appContext.logger.info(
      `[MOCK-REGISTRY-API] ✅ Generating ${documentType} for student ${studentId} (${numberOfCopies} copies)`
    );

    // Return success response
    res.status(201).json({
      success: true,
      studentId,
      documentType,
      numberOfCopies,
      documentId: `DOC-${Date.now()}`,
      documentUrl: `https://documents.mapua.edu.ph/${studentId}/${documentType}-${Date.now()}.pdf`,
      generatedAt: new Date().toISOString(),
      status: 'completed',
      message: `${documentType} generated successfully`,
    });
  } catch (error) {
    appContext.logger.error('[MOCK-REGISTRY-API] Error generating record:', error);
    res.status(500).json({ error: 'Failed to generate record' });
  }
});

/**
 * POST /api/mock/documents/generate-transcript
 * Mock Registry API endpoint - Generate student transcript
 * Called by processing task: "Generate Transcript"
 */
router.post('/documents/generate-transcript', (req: Request, res: Response) => {
  try {
    const { studentId, numberOfCopies } = req.body;

    appContext.logger.info(
      `[MOCK-REGISTRY-API] ✅ Generating transcript for student ${studentId} (${numberOfCopies} copies)`
    );

    // Return success response
    res.status(201).json({
      success: true,
      studentId,
      numberOfCopies,
      transcriptId: `TXN-${Date.now()}`,
      transcriptUrl: `https://documents.mapua.edu.ph/${studentId}/transcript-${Date.now()}.pdf`,
      generatedAt: new Date().toISOString(),
      status: 'completed',
      pages: 2,
      gpa: '3.85',
      message: 'Transcript generated successfully',
    });
  } catch (error) {
    appContext.logger.error('[MOCK-REGISTRY-API] Error generating transcript:', error);
    res.status(500).json({ error: 'Failed to generate transcript' });
  }
});

/**
 * POST /api/mock/documents/prepare-delivery
 * Mock Registry API endpoint - Prepare delivery package
 * Called by processing task: "Prepare Delivery Package"
 */
router.post('/documents/prepare-delivery', (req: Request, res: Response) => {
  try {
    const { studentId, documentTypes, deliveryMethod, numberOfCopies } = req.body;

    appContext.logger.info(
      `[MOCK-REGISTRY-API] ✅ Preparing delivery for student ${studentId} via ${deliveryMethod}`
    );

    // Return success response
    res.status(201).json({
      success: true,
      studentId,
      documentTypes,
      deliveryMethod,
      numberOfCopies,
      packageId: `PKG-${Date.now()}`,
      packageUrl: `https://documents.mapua.edu.ph/${studentId}/package-${Date.now()}.zip`,
      preparedAt: new Date().toISOString(),
      status: 'ready_for_delivery',
      estimatedDelivery: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days
      message: 'Delivery package prepared successfully',
    });
  } catch (error) {
    appContext.logger.error('[MOCK-REGISTRY-API] Error preparing delivery:', error);
    res.status(500).json({ error: 'Failed to prepare delivery' });
  }
});

export default router;
