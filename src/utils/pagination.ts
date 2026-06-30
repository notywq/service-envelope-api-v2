export interface PaginationParams {
  limit: number;
  offset: number;
}

export interface PaginationMeta extends PaginationParams {
  total: number;
  count: number;
  hasMore: boolean;
  nextOffset: number | null;
}

function firstQueryValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function parseInteger(value: unknown, fallback: number): number {
  const raw = firstQueryValue(value);
  if (typeof raw !== 'string' && typeof raw !== 'number') {
    return fallback;
  }

  const parsed = Number.parseInt(String(raw), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parsePagination(
  query: Record<string, unknown>,
  options: { defaultLimit?: number; maxLimit?: number } = {}
): PaginationParams {
  const defaultLimit = options.defaultLimit ?? 50;
  const maxLimit = options.maxLimit ?? 100;
  const requestedLimit = parseInteger(query.limit, defaultLimit);
  const requestedOffset = parseInteger(query.offset, 0);

  return {
    limit: Math.min(Math.max(requestedLimit, 1), maxLimit),
    offset: Math.max(requestedOffset, 0),
  };
}

export function paginationMeta(total: number, count: number, limit: number, offset: number): PaginationMeta {
  const nextOffset = offset + count;

  return {
    total,
    count,
    limit,
    offset,
    hasMore: nextOffset < total,
    nextOffset: nextOffset < total ? nextOffset : null,
  };
}
