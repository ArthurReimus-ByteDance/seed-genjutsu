import axios from "axios";
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
  }
}
export function createHttpClient(baseURL: string) {
  const client = axios.create({
    baseURL,
    timeout: 120000,
    headers: { Accept: "application/json" },
  });
  client.interceptors.response.use(
    (response) => response,
    (error) => {
      if (axios.isCancel(error)) return Promise.reject(error);
      const status = error.response?.status ?? 0;
      const detail = error.response?.data?.error;
      return Promise.reject(
        new ApiError(
          detail?.message ??
            (status === 413
              ? "This file is too large."
              : status === 0
                ? "Connection interrupted. Your work is saved. Please try again."
                : "Something went wrong. Please try again."),
          status,
          detail?.code ?? "NETWORK",
        ),
      );
    },
  );
  return client;
}
export const http = createHttpClient("/api");
