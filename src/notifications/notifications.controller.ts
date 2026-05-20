import { Controller, Post, Body } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('test')
  async sendTestNotification(
    @Body() body: { token: string; title: string; body: string },
  ) {
    return this.notificationsService.sendTestNotification(
      body.token,
      body.title,
      body.body,
    );
  }
}
