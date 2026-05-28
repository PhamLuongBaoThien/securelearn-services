// ========================
// Event Handlers: Media Service lắng nghe cleanup/attached events từ Course Service.
// ========================
import {
  subscribeMessage,
  Exchange,
  RoutingKey,
  type AssetCleanupPayload,
  type AssetAttachedPayload,
} from '@securelearn/common';
import videoAssetService from '../services/videoAsset.service';
import documentAssetService from '../services/documentAsset.service';
import { VideoAsset } from '../models/videoAsset.model';
import { DocumentAsset } from '../models/documentAsset.model';

/**
 * Đăng ký lắng nghe tất cả events mà Media Service quan tâm.
 * Gọi hàm này sau khi kết nối RabbitMQ thành công.
 */
export const registerEventHandlers = async (): Promise<void> => {
  // ===== 1. Xoá video asset khi course-service unbind hoặc đổi type lesson =====
  await subscribeMessage<AssetCleanupPayload>(
    Exchange.COURSE,
    RoutingKey.VIDEO_ASSET_CLEANUP,
    'media-service.video-asset-cleanup',
    async (payload) => {
      console.log(`[MediaEvent] Video cleanup requested: asset ${payload.assetId} (lesson ${payload.lessonId})`);
      await videoAssetService.deleteAsset(payload.assetId);
    }
  );

  // ===== 2. Xoá document asset (attachment) khi course-service remove attachment khỏi lesson =====
  await subscribeMessage<AssetCleanupPayload>(
    Exchange.COURSE,
    RoutingKey.DOCUMENT_ASSET_CLEANUP,
    'media-service.document-asset-cleanup',
    async (payload) => {
      console.log(`[MediaEvent] Document cleanup requested: asset ${payload.assetId} (lesson ${payload.lessonId})`);
      await documentAssetService.deleteAsset(payload.assetId);
    }
  );

  // ===== 3. Đánh dấu video asset đã được attach vào lesson =====
  await subscribeMessage<AssetAttachedPayload>(
    Exchange.COURSE,
    RoutingKey.VIDEO_ASSET_ATTACHED,
    'media-service.video-asset-attached',
    async (payload) => {
      console.log(`[MediaEvent] Video attached confirmed: asset ${payload.assetId} -> lesson ${payload.lessonId}`);
      await videoAssetService.markAssetAttached(payload.assetId);
    }
  );

  // ===== 4. Đánh dấu document asset đã được attach vào lesson =====
  await subscribeMessage<AssetAttachedPayload>(
    Exchange.COURSE,
    RoutingKey.DOCUMENT_ASSET_ATTACHED,
    'media-service.document-asset-attached',
    async (payload) => {
      console.log(`[MediaEvent] Document attached confirmed: asset ${payload.assetId} -> lesson ${payload.lessonId}`);
      await documentAssetService.markAssetAttached(payload.assetId);
    }
  );


  console.log('[MediaEvent] Đã đăng ký lắng nghe tất cả events.');
};

