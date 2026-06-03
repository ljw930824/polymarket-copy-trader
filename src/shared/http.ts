export async function fetchJson<T>(url: URL, init?: RequestInit, retries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        headers: {
          accept: "application/json",
          "user-agent": "polymarket-copy-trader/0.1",
          ...init?.headers
        }
      });
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
      }
      return (await response.json()) as T;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleep(250 * 2 ** attempt);
      }
    }
  }
  throw lastError;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
