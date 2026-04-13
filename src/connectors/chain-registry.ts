import { Injectable, Logger } from '@nestjs/common';
import { ChainConnector } from './chain-connector.interface';

@Injectable()
export class ChainRegistry {
  private readonly logger = new Logger(ChainRegistry.name);
  private readonly connectors = new Map<string, ChainConnector>();

  register(chain: string, connector: ChainConnector): void {
    this.connectors.set(chain, connector);
    this.logger.log(`Registered chain connector: ${chain}`);
  }

  get(chain: string): ChainConnector {
    const connector = this.connectors.get(chain);
    if (!connector) {
      throw new Error(`No connector registered for chain: ${chain}`);
    }
    return connector;
  }

  supportedChains(): string[] {
    return Array.from(this.connectors.keys());
  }
}
