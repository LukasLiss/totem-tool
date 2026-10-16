import "axios";

declare module "axios" {
  interface AxiosRequestConfig {
    _skipGlobalFilter?: boolean;
    _skipAuthRefresh?: boolean;
    _retried?: boolean;
    /** Do not register this request as a cancellable computation. */
    _skipJobTracking?: boolean;
    /** Set by the interceptor on tracked computations (see computationStore). */
    _totemJobId?: string;
  }
}
