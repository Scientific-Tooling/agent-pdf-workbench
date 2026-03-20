interface ApiErrorPayload {
  error?: string;
}

function asErrorMessage(payload: unknown, fallback: string): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof (payload as ApiErrorPayload).error === "string"
  ) {
    return (payload as ApiErrorPayload).error ?? fallback;
  }
  return fallback;
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`Invalid JSON response (${response.status})`);
  }
}

export async function apiPost<T>(path: string, payload: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await parseJson(response);
  if (!response.ok) {
    throw new Error(asErrorMessage(data, `Request failed: ${response.status}`));
  }
  return data as T;
}

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(path);
  const data = await parseJson(response);
  if (!response.ok) {
    throw new Error(asErrorMessage(data, `Request failed: ${response.status}`));
  }
  return data as T;
}
