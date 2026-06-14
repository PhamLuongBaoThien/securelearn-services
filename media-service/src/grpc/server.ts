import { GrpcStatus, createGrpcError, createMediaGrpcServer } from '@securelearn/common';
import videoAssetService from '../services/videoAsset.service';
import documentAssetService from '../services/documentAsset.service';

export const createInternalGrpcServer = () =>
  createMediaGrpcServer({
    getVideoAssetBinding: async (assetId) => {
      const asset = await videoAssetService.getBindingSnapshot(assetId);
      if (!asset) {
        throw createGrpcError(GrpcStatus.NOT_FOUND, 'Video asset không tồn tại.');
      }
      return asset;
    },
    getDocumentAssetBinding: async (assetId) => {
      const asset = await documentAssetService.getBindingSnapshot(assetId);
      if (!asset) {
        throw createGrpcError(GrpcStatus.NOT_FOUND, 'Document asset không tồn tại.');
      }
      return asset;
    },
  });
