import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { TeeService } from './tee.service';

@ApiTags('TEE')
@Controller('tee')
export class TeeController {
  constructor(private readonly teeService: TeeService) {}

  @Get('info')
  @ApiOperation({ summary: 'Get TEE environment info and measurements' })
  async getInfo() {
    try {
      return await this.teeService.getInfo();
    } catch {
      return { error: 'TEE not available' };
    }
  }

  @Get('attest/:agentId')
  @ApiOperation({ summary: 'Generate TEE attestation bound to agent address' })
  async attest(@Param('agentId') agentId: string) {
    return this.teeService.getAttestation(agentId);
  }
}
