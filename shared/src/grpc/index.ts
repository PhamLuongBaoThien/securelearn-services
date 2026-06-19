import * as grpc from '@grpc/grpc-js';
import {
  AssetByIdRequest,
  CourseEntitlementReply,
  CourseEntitlementRequest,
  CourseInternalServiceClient,
  CourseInternalServiceService,
  CourseInternalServiceServer,
  CourseProgressContextReply,
  CourseProgressContextRequest,
  MediaAssetBindingReply,
  MediaInternalServiceClient,
  MediaInternalServiceService,
  MediaInternalServiceServer,
  PaymentInternalServiceClient,
  PaymentInternalServiceService,
  PaymentInternalServiceServer,
  SubscriptionUsageReply,
  SubscriptionUsageRequest as GeneratedSubscriptionUsageRequest,
} from './generated/securelearn';

export type MediaAssetBinding = MediaAssetBindingReply;

export type CourseProgressContext = Omit<CourseProgressContextReply, 'reason'> & {
  reason?: string;
};

export interface CourseEntitlementResult {
  allowed: boolean;
  source?: string;
  reason?: string;
  termId?: string;
  accessEndsAt?: string;
}

export interface SubscriptionUsageRequest extends Omit<GeneratedSubscriptionUsageRequest, 'occurredAt'> {
  occurredAt?: string;
}

export type SubscriptionUsageResult = SubscriptionUsageReply;

const promisifyUnary = <TRequest extends object, TResponse extends object>(
  client: Record<string, Function>,
  methodName: string,
  request: TRequest,
): Promise<TResponse> =>
  new Promise((resolve, reject) => {
    client[methodName](request, (error: grpc.ServiceError | null, response?: TResponse) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(response as TResponse);
    });
  });

const toOptionalString = (value?: string): string => value || '';

const normalizeCourseEntitlement = (payload: CourseEntitlementReply): CourseEntitlementResult => ({
  allowed: Boolean(payload.allowed),
  source: payload.source || undefined,
  reason: payload.reason || undefined,
  termId: payload.termId || undefined,
  accessEndsAt: payload.accessEndsAt || undefined,
});

const normalizeCourseProgressContext = (payload: CourseProgressContextReply): CourseProgressContext => ({
  allowed: Boolean(payload.allowed),
  reason: payload.reason || undefined,
  courseId: payload.courseId,
  courseVersionId: payload.courseVersionId,
  totalLessons: payload.totalLessons,
  progressionMode: payload.progressionMode || 'FREE',
  instructorId: payload.instructorId || '',
  lessons: payload.lessons,
});

export const GrpcStatus = grpc.status;

export const createGrpcError = (code: grpc.status, message: string): grpc.ServiceError =>
  Object.assign(new Error(message), {
    code,
    details: message,
    metadata: new grpc.Metadata(),
  });

export const startGrpcServer = async (server: grpc.Server, bindAddress: string): Promise<grpc.Server> =>
  new Promise((resolve, reject) => {
    server.bindAsync(bindAddress, grpc.ServerCredentials.createInsecure(), (error) => {
      if (error) {
        reject(error);
        return;
      }
      server.start();
      resolve(server);
    });
  });

export const createMediaGrpcServer = (handlers: {
  getVideoAssetBinding: (assetId: string) => Promise<MediaAssetBinding>;
  getDocumentAssetBinding: (assetId: string) => Promise<MediaAssetBinding>;
}): grpc.Server => {
  const server = new grpc.Server();
  const implementation: MediaInternalServiceServer = {
    getVideoAssetBinding: async (call, callback) => {
      try {
        callback(null, await handlers.getVideoAssetBinding(call.request.assetId));
      } catch (error) {
        callback(error as grpc.ServiceError, null);
      }
    },
    getDocumentAssetBinding: async (call, callback) => {
      try {
        callback(null, await handlers.getDocumentAssetBinding(call.request.assetId));
      } catch (error) {
        callback(error as grpc.ServiceError, null);
      }
    },
  };
  server.addService(MediaInternalServiceService, implementation);
  return server;
};

export const createCourseGrpcServer = (handlers: {
  checkCourseEntitlement: (request: CourseEntitlementRequest) => Promise<CourseEntitlementResult>;
  getCourseProgressContext?: (request: CourseProgressContextRequest) => Promise<CourseProgressContext>;
}): grpc.Server => {
  const server = new grpc.Server();
  const implementation: CourseInternalServiceServer = {
    checkCourseEntitlement: async (call, callback) => {
      try {
        const response = await handlers.checkCourseEntitlement(call.request);
        callback(null, {
          allowed: response.allowed,
          source: toOptionalString(response.source),
          reason: toOptionalString(response.reason),
          termId: toOptionalString(response.termId),
          accessEndsAt: toOptionalString(response.accessEndsAt),
        });
      } catch (error) {
        callback(error as grpc.ServiceError, null);
      }
    },
    getCourseProgressContext: async (call, callback) => {
      try {
        if (!handlers.getCourseProgressContext) {
          throw createGrpcError(GrpcStatus.UNIMPLEMENTED, 'GetCourseProgressContext chưa được triển khai.');
        }
        const response = await handlers.getCourseProgressContext(call.request);
        callback(null, {
          allowed: response.allowed,
          reason: toOptionalString(response.reason),
          courseId: response.courseId,
          courseVersionId: response.courseVersionId,
          totalLessons: response.totalLessons,
          progressionMode: response.progressionMode || 'FREE',
          instructorId: response.instructorId || '',
          lessons: response.lessons,
        });
      } catch (error) {
        callback(error as grpc.ServiceError, null);
      }
    },
  };
  server.addService(CourseInternalServiceService, implementation);
  return server;
};

export const createPaymentGrpcServer = (handlers: {
  recordSubscriptionUsage: (request: SubscriptionUsageRequest) => Promise<SubscriptionUsageResult>;
}): grpc.Server => {
  const server = new grpc.Server();
  const implementation: PaymentInternalServiceServer = {
    recordSubscriptionUsage: async (call, callback) => {
      try {
        callback(null, await handlers.recordSubscriptionUsage(call.request));
      } catch (error) {
        callback(error as grpc.ServiceError, null);
      }
    },
  };
  server.addService(PaymentInternalServiceService, implementation);
  return server;
};

export const createMediaGrpcClient = (target: string) => {
  const client = new MediaInternalServiceClient(target, grpc.credentials.createInsecure());
  const rpcClient = client as unknown as Record<string, Function>;
  return {
    getVideoAssetBinding: (assetId: string) =>
      promisifyUnary<AssetByIdRequest, MediaAssetBinding>(rpcClient, 'getVideoAssetBinding', { assetId }),
    getDocumentAssetBinding: (assetId: string) =>
      promisifyUnary<AssetByIdRequest, MediaAssetBinding>(rpcClient, 'getDocumentAssetBinding', { assetId }),
    close: () => client.close(),
  };
};

export const createCourseGrpcClient = (target: string) => {
  const client = new CourseInternalServiceClient(target, grpc.credentials.createInsecure());
  const rpcClient = client as unknown as Record<string, Function>;
  return {
    checkCourseEntitlement: async (request: CourseEntitlementRequest) =>
      normalizeCourseEntitlement(
        await promisifyUnary<CourseEntitlementRequest, CourseEntitlementReply>(
          rpcClient,
          'checkCourseEntitlement',
          request,
        ),
      ),
    getCourseProgressContext: async (request: CourseProgressContextRequest) =>
      normalizeCourseProgressContext(
        await promisifyUnary<CourseProgressContextRequest, CourseProgressContextReply>(
          rpcClient,
          'getCourseProgressContext',
          request,
        ),
      ),
    close: () => client.close(),
  };
};

export const createPaymentGrpcClient = (target: string) => {
  const client = new PaymentInternalServiceClient(target, grpc.credentials.createInsecure());
  const rpcClient = client as unknown as Record<string, Function>;
  return {
    recordSubscriptionUsage: (request: SubscriptionUsageRequest) =>
      promisifyUnary<GeneratedSubscriptionUsageRequest, SubscriptionUsageReply>(
        rpcClient,
        'recordSubscriptionUsage',
        {
          ...request,
          occurredAt: request.occurredAt || '',
        },
      ),
    close: () => client.close(),
  };
};
