import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { TeeService } from '../tee/tee.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly teeService: TeeService) {}

  @Get()
  @ApiOperation({ summary: 'TEE runtime status' })
  async getHealth() {
    let teeStatus = 'unavailable';
    try {
      const info = await this.teeService.getInfo();
      if (info?.appId) teeStatus = 'active';
    } catch {}
    return {
      status: 'ok',
      service: 'wraith-spectre',
      tee: teeStatus,
      timestamp: new Date().toISOString(),
    };
  }
}
