import { createCourseGrpcClient } from '@securelearn/common';

// Entitlement check là internal query đồng bộ trong media read path.
// Chúng ta giữ HTTP cho client-facing API, còn service-to-service chuyển sang gRPC.
const courseGrpcTarget = process.env.COURSE_GRPC_TARGET || 'course-service:6002';

export const courseGrpcClient = createCourseGrpcClient(courseGrpcTarget);
