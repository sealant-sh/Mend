import type { MendConnection } from "./config.js";

const responseMessage = (value: unknown, fallback: string): string => {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("message" in value)
  ) {
    return fallback;
  }
  const message = value.message;
  return typeof message === "string" && message !== "" ? message : fallback;
};

/** An explicit Mend discovery or API failure suitable for display by the extension. */
export class MendApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "MendApiError";
  }
}

/** Execute one authenticated Mend request without translating transport failures into local state. */
export const requestMend = async (
  connection: MendConnection,
  requestPath: string,
  init?: RequestInit,
): Promise<unknown> => {
  const headers = new Headers(init?.headers);
  headers.set("accept", "application/json");
  if (init?.body !== undefined) headers.set("content-type", "application/json");
  if (connection.token !== null) headers.set("authorization", `Bearer ${connection.token}`);
  let response: Response;
  try {
    response = await fetch(`${connection.url}/api${requestPath}`, { ...init, headers });
  } catch (cause) {
    throw new MendApiError(
      `Cannot reach Mend at ${connection.url}.${cause instanceof Error ? ` ${cause.message}` : ""}`,
      null,
    );
  }
  const text = await response.text();
  let body: unknown = null;
  if (text !== "") {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }
  if (!response.ok) {
    throw new MendApiError(
      responseMessage(body, `Mend responded ${response.status}.`),
      response.status,
    );
  }
  return body;
};
