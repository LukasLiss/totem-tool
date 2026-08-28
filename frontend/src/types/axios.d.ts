import "axios";

declare module "axios" {
  interface AxiosRequestConfig {
    _skipGlobalFilter?: boolean;
  }
}
