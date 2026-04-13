import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import type { Hex } from 'viem';
import { DstackClient } from '@phala/dstack-sdk';

@Injectable()
export class TeeService {
  private readonly logger = new Logger(TeeService.name);
  private readonly dstack: DstackClient;

  constructor() {
    this.dstack = new DstackClient();
    this.logger.log('DstackClient initialized');
  }

  /**
   * Derive a raw 32-byte seed for an agent on a specific chain from the TEE.
   * Deterministic: same agentId + chain always produces the same seed.
   * Private key never leaves TEE memory, never stored in database.
   *
   * Path includes chain to produce different keys per chain for the same agent ID.
   */
  async deriveAgentSeed(agentId: string, chain: string): Promise<Uint8Array> {
    const result = await this.dstack.getKey(`wraith/agent/${agentId}/${chain}`, chain);
    return createHash('sha256').update(result.key).digest();
  }

  /**
   * Derive a hex-encoded private key for EVM chains.
   */
  async deriveAgentPrivateKey(agentId: string, chain: string): Promise<Hex> {
    const seed = await this.deriveAgentSeed(agentId, chain);
    return `0x${Buffer.from(seed).toString('hex')}` as Hex;
  }

  /**
   * Generate a TEE attestation quote bound to an address/public key.
   * Proves that this address was generated inside genuine TEE hardware.
   */
  async getAttestation(address: string) {
    const reportData = createHash('sha256').update(address).digest();

    const attestation = await this.dstack.getQuote(reportData);
    const info = await this.dstack.info();

    return {
      quote: attestation.quote,
      appId: info.app_id,
      composeHash: info.tcb_info.compose_hash,
    };
  }

  /**
   * Get TEE environment info — app_id, measurements, compose_hash.
   */
  async getInfo() {
    const info = await this.dstack.info();
    return {
      appId: info.app_id,
      instanceId: info.instance_id,
      appName: info.app_name,
      deviceId: info.device_id,
      composeHash: info.tcb_info.compose_hash,
      osImageHash: info.tcb_info.os_image_hash,
      mrtd: info.tcb_info.mrtd,
      rtmr0: info.tcb_info.rtmr0,
      rtmr1: info.tcb_info.rtmr1,
      rtmr2: info.tcb_info.rtmr2,
      rtmr3: info.tcb_info.rtmr3,
    };
  }

  /**
   * Check if running inside a real TEE.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const info = await this.dstack.info();
      return !!info?.app_id;
    } catch {
      return false;
    }
  }
}
