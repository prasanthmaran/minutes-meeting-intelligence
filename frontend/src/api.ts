export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, options);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(
      typeof body?.detail === "string"
        ? body.detail
        : `Request failed (${response.status}). Please try again.`,
      response.status
    );
  }
  return response.status === 204 ? (undefined as T) : response.json();
}
export function clock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60)
    .toString()
    .padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return h ? `${h.toString().padStart(2, "0")}:${m}:${s}` : `${m}:${s}`;
}

export function meetingListPath(query: {
  q: string;
  status: string;
  sort: string;
  order: string;
  page: number;
  page_size: number;
}): string {
  const params = new URLSearchParams({
    status: query.status,
    sort: query.sort,
    order: query.order,
    page: String(query.page),
    page_size: String(query.page_size),
  });
  if (query.q.trim()) params.set("q", query.q.trim());
  return `/meetings?${params}`;
}
