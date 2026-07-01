import { createCourseGrpcClient } from '@securelearn/common';
export const courseGrpcClient = createCourseGrpcClient(process.env.COURSE_GRPC_TARGET || 'course-service:6002');