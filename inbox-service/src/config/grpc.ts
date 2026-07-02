import { createIdentityGrpcClient, createCourseGrpcClient } from '@securelearn/common';
export const identityGrpcClient = createIdentityGrpcClient(process.env.IDENTITY_GRPC_TARGET || 'localhost:6001');
export const courseGrpcClient = createCourseGrpcClient(process.env.COURSE_GRPC_TARGET || 'localhost:6002');
