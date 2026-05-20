import { Injectable, OnModuleInit } from '@nestjs/common';
import * as admin from 'firebase-admin';
import * as path from 'path';

@Injectable()
export class NotificationsService implements OnModuleInit {
  onModuleInit() {
    // Khởi tạo Firebase Admin
    // Ưu tiên tệp secret trên Render, nếu không có thì dùng tệp local
    let serviceAccountPath = path.join(process.cwd(), 'firebase-service-account.json');
    
    // Nếu không tìm thấy file Render (thường là khi chạy local), thử file local cũ
    const fs = require('fs');
    if (!fs.existsSync(serviceAccountPath)) {
      serviceAccountPath = path.join(process.cwd(), 'service-account.json');
    }
    
    try {
      if (fs.existsSync(serviceAccountPath)) {
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccountPath),
        });
        console.log('✅ Firebase Admin initialized thành công từ:', path.basename(serviceAccountPath));
      } else {
        console.warn('⚠️ Cảnh báo: Không tìm thấy tệp Firebase Service Account. Firebase Push sẽ không hoạt động.');
      }
    } catch (error) {
      console.error('❌ Lỗi khởi tạo Firebase Admin:', error.message);
    }
  }

  async sendNotification(params: {
    token: string;
    title: string;
    body: string;
    data?: Record<string, string>;
    channelId?: string;
  }) {
    const { token, title, body, data, channelId } = params;

    const message: admin.messaging.Message = {
      notification: {
        title,
        body,
      },
      token: token,
      data: {
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
        ...data,
      },
      android: {
        priority: 'high',
        notification: {
          channelId: channelId || 'default',
          priority: 'high',
          sound: channelId === 'job_alerts' ? 'emergency_alarm' : 'default',
        },
      },
      apns: {
        payload: {
          aps: {
            contentAvailable: true,
            sound: channelId === 'job_alerts' ? 'emergency_alarm.wav' : 'default',
          },
        },
      },
    };

    try {
      const response = await admin.messaging().send(message);
      console.log('🚀 Gửi thông báo thành công:', response);
      return { success: true, messageId: response };
    } catch (error) {
      console.error('❌ Lỗi gửi thông báo:', error);
      throw error;
    }
  }

  async sendTestNotification(token: string, title: string, body: string) {
    return this.sendNotification({ token, title, body });
  }
}
