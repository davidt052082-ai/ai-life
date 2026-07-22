export class CollectorError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "CollectorError";
    this.code = code;
    this.status = options.status || 400;
    this.warnings = options.warnings || [];
  }
}

export function toErrorResponse(error) {
  if (error instanceof CollectorError) {
    return {
      status: error.status,
      body: {
        error: error.code,
        message: error.message,
        warnings: error.warnings
      }
    };
  }

  return {
    status: 500,
    body: {
      error: "COLLECT_FAILED",
      message: "无法从该页面提取稳定的产品信息",
      warnings: []
    }
  };
}
