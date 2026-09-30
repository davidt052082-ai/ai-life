export function classifyHuaweiError({ status, code } = {}) {
  if (status === 401) return { code: "HUAWEI_REAUTH_REQUIRED", retryable: false };
  if (status === 403) return { code: "HUAWEI_PERMISSION_DENIED", retryable: false };
  if (status === 429) return { code: "HUAWEI_RATE_LIMITED", retryable: true };
  if (status >= 500) return { code: "HUAWEI_UPSTREAM_UNAVAILABLE", retryable: true };
  return { code: code || "HUAWEI_REQUEST_FAILED", retryable: false };
}

export function huaweiError({ status, code } = {}) {
  const classified = classifyHuaweiError({ status, code });
  const error = new Error(classified.code);
  Object.assign(error, classified, { status });
  return error;
}
