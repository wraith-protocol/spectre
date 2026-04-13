import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'TEE runtime status' })
  getHealth() {
    return {
      status: 'ok',
      service: 'wraith-spectre',
      timestamp: new Date().toISOString(),
    };
  }
}
