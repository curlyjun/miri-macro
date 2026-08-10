"use strict";

class ApiError extends Error {
  constructor(message, { code = "API_ERROR", status, cause } = {}) {
    super(message, { cause });
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

function createApiClient({
  fetchImpl = fetch,
  refreshAuth = async () => false,
  sleepImpl = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeoutMs = Number(process.env.API_TIMEOUT_MS) || 15000,
  retries = 2,
  includeErrorBody = false,
} = {}) {
  async function fetchWithTimeout(url, options) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resolvedOptions = {
        ...options,
        headers:
          typeof options.headers === "function"
            ? options.headers()
            : options.headers,
        signal: controller.signal,
      };
      return await fetchImpl(url, resolvedOptions);
    } catch (error) {
      if (error.name === "AbortError") {
        throw new ApiError(`요청 제한 시간 ${timeoutMs}ms 초과`, {
          code: "TIMEOUT",
          cause: error,
        });
      }
      throw new ApiError(error.message, { code: "NETWORK_ERROR", cause: error });
    } finally {
      clearTimeout(timeout);
    }
  }

  async function requestJson(url, options = {}) {
    let refreshed = false;
    let attempt = 0;

    while (true) {
      try {
        const response = await fetchWithTimeout(url, options);
        if (response.status === 401 && !refreshed) {
          refreshed = true;
          if (await refreshAuth()) continue;
        }
        if (!response.ok) {
          // 서버가 실패 이유를 본문에 담아 보내는 경우(텔레그램 등) 상태 코드만으로는
          // 원인을 알 수 없어 본문을 함께 남긴다.
          const detail = includeErrorBody
            ? await response.text().then(
                (text) => text.trim().slice(0, 200),
                () => "",
              )
            : "";
          throw new ApiError(detail ? `HTTP ${response.status} ${detail}` : `HTTP ${response.status}`, {
            code: response.status === 401 ? "UNAUTHORIZED" : "HTTP_ERROR",
            status: response.status,
          });
        }
        return await response.json();
      } catch (error) {
        const retryable =
          error.code === "NETWORK_ERROR" ||
          error.code === "TIMEOUT" ||
          (error.code === "HTTP_ERROR" && error.status >= 500);
        if (!retryable || attempt >= retries) throw error;
        await sleepImpl(250 * 2 ** attempt);
        attempt += 1;
      }
    }
  }

  return { requestJson };
}

module.exports = { ApiError, createApiClient };
