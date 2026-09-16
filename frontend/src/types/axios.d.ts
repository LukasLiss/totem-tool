import "axios";

declare module "axios" {
  interface AxiosRequestConfig {
    _skipGlobalFilter?: boolean;
    _skipAuthRefresh?: boolean;
    _retried?: boolean;
  }
}
