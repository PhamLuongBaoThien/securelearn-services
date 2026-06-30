import { createIdentityGrpcClient } from '@securelearn/common';
export const identityGrpcClient = createIdentityGrpcClient(process.env.IDENTITY_GRPC_TARGET || 'identity-service:6001');

