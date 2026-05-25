#!/usr/bin/env node
/**
 * Helper script to artificially approve all pending approvals for a request
 * and trigger payment orchestration
 * 
 * Usage: node approve-all.js "req-1779749513313-8442dc5f"
 */

import mongoose from 'mongoose';
import axios from 'axios';

const requestId = process.argv[2];

if (!requestId) {
  console.error('❌ Usage: node approve-all.js "<request-id>"');
  process.exit(1);
}

const MONGO_URI = process.env.MONGODB_URI || 'mongodb+srv://mapua_user:mapua_password_phase2@mapua-cluster.mongodb.net/service-envelope-dev?retryWrites=true&w=majority';
const API_URL = 'http://localhost:8000';

async function approveAllPending() {
  try {
    console.log(`🔍 Connecting to MongoDB...`);
    await mongoose.connect(MONGO_URI);
    console.log(`✅ Connected to MongoDB`);

    // Get the database connection
    const db = mongoose.connection.getClient().db('service-envelope-dev');
    
    // Query for approval tokens for this request
    console.log(`\n🔎 Fetching approval tokens for request: ${requestId}`);
    const tokens = await db.collection('approvalTokens').find({ requestId }).toArray();
    
    if (tokens.length === 0) {
      console.log(`⚠️  No pending approval tokens found for request ${requestId}`);
      await mongoose.disconnect();
      process.exit(0);
    }

    console.log(`\n📋 Found ${tokens.length} pending approval token(s):`);
    tokens.forEach((t, i) => {
      console.log(`   ${i + 1}. Approver: ${t.approverId} | Token: ${t.token.substring(0, 8)}...`);
    });

    // Approve each token
    console.log(`\n⏳ Approving all tokens...\n`);
    let successCount = 0;
    let failCount = 0;

    for (const tokenDoc of tokens) {
      if (tokenDoc.used) {
        console.log(`   ⏭️  [SKIPPED] Token for ${tokenDoc.approverId} already used`);
        continue;
      }

      try {
        console.log(`   ⏳ Approving ${tokenDoc.approverId}...`);
        const response = await axios.post(
          `${API_URL}/api/approvals/${tokenDoc.token}/approve`,
          { comment: 'Auto-approved for testing' },
          { headers: { 'Content-Type': 'application/json' } }
        );
        
        console.log(`   ✅ Approved ${tokenDoc.approverId}`);
        console.log(`      Message: ${response.data.message}`);
        console.log(`      Approval Complete: ${response.data.approvalComplete}`);
        successCount++;

        // If approval is complete, we can stop approving others
        if (response.data.approvalComplete) {
          console.log(`\n✅ All required approvals received! Payment orchestration should now be processing...`);
          break;
        }
      } catch (error) {
        console.error(`   ❌ Failed to approve ${tokenDoc.approverId}: ${error.response?.data?.error || error.message}`);
        failCount++;
      }
    }

    console.log(`\n📊 Approval Summary:`);
    console.log(`   ✅ Successfully approved: ${successCount}`);
    console.log(`   ❌ Failed: ${failCount}`);
    console.log(`\n✨ Check server logs for payment orchestration logs!`);

    await mongoose.disconnect();
    process.exit(0);

  } catch (error) {
    console.error('❌ Error:', error.message);
    await mongoose.disconnect();
    process.exit(1);
  }
}

approveAllPending();
