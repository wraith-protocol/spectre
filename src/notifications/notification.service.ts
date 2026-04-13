import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../storage/database.service';

@Injectable()
export class NotificationService {
  constructor(private readonly db: DatabaseService) {}

  async create(agentId: string, type: string, title: string, body: string) {
    await this.db.notifications.save({ agentId, type, title, body });
  }

  async getAll(agentId: string, limit = 50) {
    const notifications = await this.db.notifications.find({
      where: { agentId },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    const unreadCount = await this.db.notifications.count({
      where: { agentId, read: false },
    });
    return { notifications, unreadCount };
  }

  async markAllRead(agentId: string) {
    await this.db.notifications.update({ agentId }, { read: true });
  }

  async markRead(id: number, agentId: string) {
    await this.db.notifications.update({ id, agentId }, { read: true });
  }

  async deleteAll(agentId: string) {
    await this.db.notifications.delete({ agentId });
  }
}
