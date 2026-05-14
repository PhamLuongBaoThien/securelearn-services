// ========================
// Event Handlers: Media Service lắng nghe cleanup events từ Course Service.
// Khi course-service unbind hoặc đổi type lesson, nó phát event cleanup
// để media-service xoá file vật lý trên S3 và record trong DB.
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

  // ===== 2. Xoá document asset khi course-service unbind hoặc đổi type lesson =====
  await subscribeMessage<AssetCleanupPayload>(
    Exchange.COURSE,
    RoutingKey.DOCUMENT_ASSET_CLEANUP,
    'media-service.document-asset-cleanup',
    async (payload) => {
      console.log(`[MediaEvent] Document cleanup requested: asset ${payload.assetId} (lesson ${payload.lessonId})`);
      await documentAssetService.deleteAsset(payload.assetId);
    }
  );

  await subscribeMessage<AssetAttachedPayload>(
    Exchange.COURSE,
    RoutingKey.VIDEO_ASSET_ATTACHED,
    'media-service.video-asset-attached',
    async (payload) => {
      console.log(`[MediaEvent] Video attached confirmed: asset ${payload.assetId} -> lesson ${payload.lessonId}`);
      await videoAssetService.markAssetAttached(payload.assetId, payload.lessonId);
    }
  );

  await subscribeMessage<AssetAttachedPayload>(
    Exchange.COURSE,
    RoutingKey.DOCUMENT_ASSET_ATTACHED,
    'media-service.document-asset-attached',
    async (payload) => {
      console.log(`[MediaEvent] Document attached confirmed: asset ${payload.assetId} -> lesson ${payload.lessonId}`);
      await documentAssetService.markAssetAttached(payload.assetId, payload.lessonId);
    }
  );

  console.log('[MediaEvent] Đã đăng ký lắng nghe tất cả events.');
};
