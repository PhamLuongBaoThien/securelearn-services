import {
  publishMessage,
  Exchange,
  RoutingKey,
  type VideoAssetStatusPayload,
} from '@securelearn/common';

export const publishVideoReady = async (payload: VideoAssetStatusPayload) => {
  await publishMessage(Exchange.MEDIA, RoutingKey.VIDEO_ASSET_READY, payload);
};

export const publishVideoFailed = async (payload: VideoAssetStatusPayload) => {
  await publishMessage(Exchange.MEDIA, RoutingKey.VIDEO_ASSET_FAILED, payload);
};
