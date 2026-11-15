// One error shape for every /v1 response: RFC 9457 Problem Details (`application/problem+json`), plus a
// machine-readable `code` the web switches on and, for validation failures, `errors` by field path.

import type { z } from "zod";

export const ERROR_STATUS = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  payload_too_large: 413,
  unprocessable: 422,
  rate_limited: 429,
  internal: 500,
  unavailable: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly issues?: readonly { path: string; message: string }[],
    /** Extra response headers, such as `Retry-After` on 429. */
    readonly headers: Readonly<Record<string, string>> = {},
  ) {
    super(message);
  }

  get status(): (typeof ERROR_STATUS)[ErrorCode] {
    return ERROR_STATUS[this.code];
  }

  toProblem(instance: string) {
    return {
      type: `urn:zal:error:${this.code}`,
      title: this.code.replaceAll("_", " "),
      status: this.status,
      detail: this.message,
      instance,
      code: this.code,
      ...(this.issues ? { errors: this.issues } : {}),
    };
  }
}

/** Parses untrusted input or throws a 400 that lists each issue by path. */
export function parseInput<T extends z.ZodType>(schema: T, input: unknown): z.output<T> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new ApiError(
    "bad_request",
    "Invalid request",
    result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
  );
}
