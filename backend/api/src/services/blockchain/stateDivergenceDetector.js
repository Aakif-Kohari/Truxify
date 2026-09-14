import { ethers } from 'ethers';
import crypto from 'crypto';
import logger from '../../middleware/logger.js';
import * as Sentry from '@sentry/node';
import { supabase, supabaseAdmin } from '../../config/db.js';
import { measureExecution } from '../../core/performanceMetrics.js';

const FINALITY_THRESHOLD = 100; // Blocks after which transaction is considered finalized
const DIVERGENCE_CHECK_INTERVAL = 30000; // 30 seconds
const RPC_TIMEOUT = 10000; // 10 seconds per RPC call
const MIN_CONSENSUS = 2; // Minimum nodes needed for consensus

class StateDivergenceDetector {
  constructor(deps = {}) {
    this.rpcNodes = this.parseRpcNodes();
    this.providers = this.initializeProviders();
    this.divergences = new Map();
    this.stateCache = new Map();
    this.startMonitoring();
  }

  parseRpcNodes() {
    const rpcUrls = process.env.POLYGON_RPC_NODES || process.env.POLYGON_RPC_URL || '';
    return rpcUrls.split(',').map(url => url.trim()).filter(url => url);
  }

  initializeProviders() {
    return this.rpcNodes.map(url => new ethers.JsonRpcProvider(url));
  }

  startMonitoring() {
    const interval = parseInt(process.env.DIVERGENCE_CHECK_INTERVAL_MS || '30000', 10);

    setInterval(async () => {
      try {
        await this.checkForDivergence();
      } catch (err) {
        logger.error({ err }, '[StateDivergenceDetector] Monitoring error');
      }
    }, interval);
  }

  async checkForDivergence() {
    return measureExecution('StateDivergenceDetector.checkForDivergence', async () => {
      const nodeStates = await this.queryAllNodes();

      if (nodeStates.length < MIN_CONSENSUS) {
        logger.warn('[StateDivergenceDetector] Insufficient nodes responding:', nodeStates.length);
        return { divergenceDetected: false, reason: 'insufficient_nodes' };
      }

      const divergenceResult = this.analyzeDivergence(nodeStates);

      if (divergenceResult.divergenceDetected) {
        await this.handleDivergence(divergenceResult);
      }

      return divergenceResult;
    });
  }

  async queryAllNodes() {
    const queries = this.providers.map((provider, idx) =>
      this.queryNode(provider, idx).catch(err => ({
        nodeIndex: idx,
        error: err.message,
      }))
    );

    const results = await Promise.allSettled(queries);

    return results
      .filter(r => r.status === 'fulfilled' && !r.value.error)
      .map(r => r.value);
  }

  async queryNode(provider, nodeIndex) {
    return measureExecution(`StateDivergenceDetector.queryNode[${nodeIndex}]`, async () => {
      try {
        const blockNumber = await Promise.race([
          provider.getBlockNumber(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('RPC timeout')), RPC_TIMEOUT)
          ),
        ]);

        const block = await provider.getBlock(blockNumber);

        return {
          nodeIndex,
          rpcUrl: this.rpcNodes[nodeIndex],
          blockNumber,
          blockHash: block?.hash ?? null,
          blockTimestamp: block?.timestamp ?? null,
          miner: block?.miner ?? null,
          transactionCount: block?.transactions?.length ?? 0,
          queryTime: Date.now(),
        };
      } catch (err) {
        logger.warn({ err, nodeIndex }, '[StateDivergenceDetector] Node query failed');
        throw err;
      }
    });
  }

  analyzeDivergence(nodeStates) {
    if (!nodeStates || !Array.isArray(nodeStates) || nodeStates.length === 0) {
      return { divergenceDetected: false, reason: 'no_responses' };
    }

    const validStates = nodeStates.filter(s => s != null && typeof s.blockNumber === 'number');
    if (validStates.length === 0) {
      return { divergenceDetected: false, reason: 'no_valid_states' };
    }

    const blockNumbers = validStates.map(s => s.blockNumber);
    const maxBlockNumber = Math.max(...blockNumbers);
    const minBlockNumber = Math.min(...blockNumbers);
    const blockDivergence = maxBlockNumber - minBlockNumber;

    const divergenceDetails = {
      timestamp: new Date().toISOString(),
      nodeCount: validStates.length,
      maxBlockNumber,
      minBlockNumber,
      blockDivergence,
      nodeStates: validStates,
      divergenceDetected: blockDivergence > 10,
      divergenceSeverity: this.calculateDivergenceSeverity(blockDivergence),
      canonicalState: validStates.find(s => s.blockNumber === maxBlockNumber) || null,
    };

    if (divergenceDetails.divergenceDetected) {
      logger.warn('[StateDivergenceDetector] Divergence detected:', {
        blockDivergence,
        severity: divergenceDetails.divergenceSeverity,
      });
    }

    return divergenceDetails;
  }

  calculateDivergenceSeverity(blockDivergence) {
    if (blockDivergence === 0) return 'NONE';
    if (blockDivergence <= 5) return 'LOW';
    if (blockDivergence <= 20) return 'MEDIUM';
    if (blockDivergence <= 50) return 'HIGH';
    return 'CRITICAL';
  }

  async handleDivergence(divergenceResult) {
    return measureExecution('StateDivergenceDetector.handleDivergence', async () => {
      const divergenceId = `div_${crypto.randomBytes(16).toString('hex')}`;

      await this.logDivergence(divergenceId, divergenceResult);
      await this.alertOnDivergence(divergenceId, divergenceResult);

      if (divergenceResult.divergenceSeverity === 'CRITICAL') {
        await this.triggerStateReconciliation(divergenceResult.canonicalState);
      }

      this.divergences.set(divergenceId, {
        ...divergenceResult,
        detectedAt: Date.now(),
        resolved: false,
      });
    });
  }

  async logDivergence(divergenceId, divergenceResult) {
    try {
      await (supabaseAdmin || supabase)
        .from('blockchain_divergence_log')
        .insert([{
          divergence_id: divergenceId,
          severity: divergenceResult?.divergenceSeverity,
          block_divergence: divergenceResult?.blockDivergence,
          node_states: divergenceResult?.nodeStates,
          canonical_state: divergenceResult?.canonicalState,
          detected_at: divergenceResult?.timestamp,
        }]);

      logger.info('[StateDivergenceDetector] Divergence logged:', divergenceId);
    } catch (err) {
      logger.error({ err }, '[StateDivergenceDetector] Failed to log divergence');
    }
  }

  async alertOnDivergence(divergenceId, divergenceResult) {
    try {
      const alert = {
        type: 'BLOCKCHAIN_STATE_DIVERGENCE',
        severity: divergenceResult?.divergenceSeverity === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
        divergenceId,
        blockDivergence: divergenceResult?.blockDivergence,
        message: `Blockchain state divergence of ${divergenceResult?.blockDivergence} blocks detected`,
        nodeCount: divergenceResult?.nodeCount,
        divergenceDetails: divergenceResult,
        timestamp: divergenceResult?.timestamp,
      };

      logger.warn('[StateDivergenceDetector] Divergence alert:', alert);
    } catch (err) {
      logger.error({ err }, '[StateDivergenceDetector] Failed to alert divergence');
    }
  }

  async triggerStateReconciliation(canonicalState) {
    return measureExecution('StateDivergenceDetector.triggerStateReconciliation', async () => {
      try {
        if (!canonicalState || typeof canonicalState.blockNumber !== 'number') {
          logger.warn('[StateDivergenceDetector] Invalid or missing canonical state for reconciliation');
          return;
        }

        logger.warn('[StateDivergenceDetector] Triggering state reconciliation from block:', canonicalState.blockNumber);

        await (supabaseAdmin || supabase)
          .from('blockchain_reconciliation_jobs')
          .insert([{
            status: 'pending',
            source_block_number: canonicalState.blockNumber,
            canonical_state: canonicalState,
            created_at: new Date().toISOString(),
          }]);

        logger.info('[StateDivergenceDetector] Reconciliation job queued');
      } catch (err) {
        logger.error({ err }, '[StateDivergenceDetector] Failed to queue reconciliation');
        Sentry.captureException(err);
      }
    });
  }

  async checkTransactionFinality(txHash, currentBlockNumber) {
    return measureExecution('StateDivergenceDetector.checkTransactionFinality', async () => {
      try {
        const receipt = await Promise.race([
          this.providers[0].getTransactionReceipt(txHash),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('RPC timeout')), RPC_TIMEOUT)
          ),
        ]);

        if (!receipt) {
          return {
            finalized: false,
            reason: 'not_mined',
            txHash,
          };
        }

        const currentBlock = typeof currentBlockNumber === 'number' ? currentBlockNumber : 0;
        const receiptBlock = typeof receipt.blockNumber === 'number' ? receipt.blockNumber : 0;
        const blocksSinceTransaction = currentBlock - receiptBlock;
        const isFinalized = blocksSinceTransaction >= FINALITY_THRESHOLD;

        return {
          finalized: isFinalized,
          blockNumber: receipt.blockNumber,
          blocksSinceTransaction,
          finalityThreshold: FINALITY_THRESHOLD,
          status: receipt.status === 1 ? 'success' : 'failed',
          txHash,
        };
      } catch (err) {
        logger.error({ err }, '[StateDivergenceDetector] Finality check failed');
        return { finalized: false, error: err.message, txHash };
      }
    });
  }

  async getConsensusState() {
    return measureExecution('StateDivergenceDetector.getConsensusState', async () => {
      const nodeStates = await this.queryAllNodes();

      if (!nodeStates || nodeStates.length < MIN_CONSENSUS) {
        logger.error('[StateDivergenceDetector] Insufficient nodes for consensus');
        return null;
      }

      const validStates = nodeStates.filter(s => s != null && typeof s.blockNumber === 'number');
      if (validStates.length === 0) {
        logger.error('[StateDivergenceDetector] No valid node states found for consensus');
        return null;
      }

      const sorted = validStates.sort((a, b) => b.blockNumber - a.blockNumber);
      return sorted[0] || null;
    });
  }

  compareStates(onChainState, offChainState) {
    if (!onChainState && !offChainState) {
      return { divergent: false, reason: 'both_null' };
    }
    if (!onChainState) {
      logger.warn('[StateDivergenceDetector] On-chain state is null while off-chain state exists');
      return {
        divergent: true,
        reason: 'on_chain_state_null',
        onChainState: null,
        offChainState,
      };
    }
    if (!offChainState) {
      logger.warn('[StateDivergenceDetector] Off-chain state is null while on-chain state exists');
      return {
        divergent: true,
        reason: 'off_chain_state_null',
        onChainState,
        offChainState: null,
      };
    }

    const onChainBlock = typeof onChainState.blockNumber === 'number' ? onChainState.blockNumber : null;
    const offChainBlock = typeof offChainState.blockNumber === 'number' ? offChainState.blockNumber : null;
    const blockDifference = (onChainBlock !== null && offChainBlock !== null)
      ? Math.abs(onChainBlock - offChainBlock)
      : null;

    const hashMatch = onChainState.blockHash && offChainState.blockHash
      ? onChainState.blockHash === offChainState.blockHash
      : true;

    return {
      divergent: (blockDifference !== null && blockDifference > 10) || !hashMatch,
      blockDifference,
      hashMatch,
      onChainState,
      offChainState,
    };
  }

  async reconcileState(oldState, newState) {
    return measureExecution('StateDivergenceDetector.reconcileState', async () => {
      const reconciliationId = `recon_${crypto.randomBytes(16).toString('hex')}`;

      let blockNumberDifference = null;
      let divergenceReason = null;
      let status = 'in_progress';

      if (!oldState && !newState) {
        divergenceReason = 'both_states_null';
        status = 'failed';
        logger.warn('[StateDivergenceDetector] Both on-chain and off-chain states are null during reconciliation');
      } else if (!oldState) {
        divergenceReason = 'off_chain_state_null';
        blockNumberDifference = typeof newState.blockNumber === 'number' ? newState.blockNumber : null;
        logger.warn({ newState }, '[StateDivergenceDetector] Off-chain state is null during reconciliation');
      } else if (!newState) {
        divergenceReason = 'on_chain_state_null';
        blockNumberDifference = typeof oldState.blockNumber === 'number' ? -oldState.blockNumber : null;
        logger.warn({ oldState }, '[StateDivergenceDetector] On-chain state is null during reconciliation');
      } else {
        const oldBlock = typeof oldState.blockNumber === 'number' ? oldState.blockNumber : 0;
        const newBlock = typeof newState.blockNumber === 'number' ? newState.blockNumber : 0;
        blockNumberDifference = newBlock - oldBlock;
      }

      const reconciliation = {
        reconciliationId,
        oldState: oldState || null,
        newState: newState || null,
        blockNumberDifference,
        divergenceReason,
        initiatedAt: new Date().toISOString(),
        status,
      };

      try {
        await (supabaseAdmin || supabase)
          .from('state_reconciliations')
          .insert([reconciliation]);
        logger.info('[StateDivergenceDetector] State reconciliation initiated:', reconciliationId);
      } catch (err) {
        logger.error({ err }, '[StateDivergenceDetector] Failed to record reconciliation in DB, continuing with in-memory record.');
      }

      return reconciliation;
    });
  }

  getDivergenceMetrics() {
    const metrics = {
      totalDivergences: this.divergences.size,
      activeDivergences: Array.from(this.divergences.values()).filter(d => !d.resolved).length,
      lastChecked: new Date().toISOString(),
      rpcNodeCount: this.rpcNodes.length,
    };

    return metrics;
  }

  async resolveDivergence(divergenceId, resolutionDetails) {
    const divergence = this.divergences.get(divergenceId);
    if (!divergence) {
      return { success: false, reason: 'divergence_not_found' };
    }

    divergence.resolved = true;
    divergence.resolvedAt = Date.now();
    divergence.resolutionDetails = resolutionDetails;

    try {
      await (supabaseAdmin || supabase)
        .from('blockchain_divergence_log')
        .update({
          resolved: true,
          resolved_at: new Date().toISOString(),
          resolution_details: resolutionDetails,
        })
        .eq('divergence_id', divergenceId);

      logger.info('[StateDivergenceDetector] Divergence resolved:', divergenceId);
      return { success: true };
    } catch (err) {
      logger.error('[StateDivergenceDetector] Failed to resolve divergence:', err.message);
      return { success: false, error: err.message };
    }
  }
}

export default StateDivergenceDetector;
export { FINALITY_THRESHOLD };
