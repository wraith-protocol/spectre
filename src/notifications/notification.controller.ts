import { Controller, Get, Post, Delete, Param } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { NotificationService } from './notification.service';

@ApiTags('Notifications')
@Controller('agent/:id/notifications')
export class NotificationController {
  constructor(private readonly notifService: NotificationService) {}

  @Get()
  @ApiOperation({ summary: 'Get agent notifications' })
  async getNotifications(@Param('id') agentId: string) {
    return this.notifService.getAll(agentId);
  }

  @Post('read')
  @ApiOperation({ summary: 'Mark notifications as read' })
  async markRead(@Param('id') agentId: string) {
    await this.notifService.markAllRead(agentId);
    return { updated: true };
  }

  @Delete()
  @ApiOperation({ summary: 'Delete all notifications' })
  async deleteAll(@Param('id') agentId: string) {
    await this.notifService.deleteAll(agentId);
    return { deleted: true };
  }
}
