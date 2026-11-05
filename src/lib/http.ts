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
export const http = axios.create({
  baseURL: "/api",
  timeout: 120000,
  withCredentials: true,
  headers: { Accept: "application/json" },
});
http.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error.response?.status ?? 0;
    const detail = error.response?.data?.error;
    if (
      status === 401 &&
      typeof window !== "undefined" &&
      !String(error.config?.url).includes("/auth/login")
    )
      window.dispatchEvent(new Event("recast:auth-required"));
    return Promise.reject(
      new ApiError(
        detail?.message ??
          (status === 413
            ? "This file is too large."
            : status === 0
              ? "Connection interrupted. Please try again."
              : "Something went wrong. Please try again."),
        status,
        detail?.code ?? "NETWORK",
      ),
    );
  },
);
