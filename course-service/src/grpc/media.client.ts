import { createMediaGrpcClient } from '@securelearn/common';

// Internal asset verification là RPC đồng bộ giữa service với service.
// Chỗ này dùng gRPC để bỏ lớp HTTP + JSON + auth forwarding không cần thiết.
const mediaGrpcTarget = process.env.MEDIA_GRPC_TARGET || 'media-service:6003';

export const mediaGrpcClient = createMediaGrpcClient(mediaGrpcTarget);
