import { Global, Module } from '@nestjs/common';
import { TeeService } from './tee.service';
import { TeeController } from './tee.controller';

@Global()
@Module({
  providers: [TeeService],
  controllers: [TeeController],
  exports: [TeeService],
})
export class TeeModule {}
