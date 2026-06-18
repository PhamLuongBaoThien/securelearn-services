import { createCourseGrpcClient } from '@securelearn/common';

const courseGrpcTarget = process.env.COURSE_GRPC_TARGET || 'localhost:6002';

export const courseGrpcClient = createCourseGrpcClient(courseGrpcTarget);
