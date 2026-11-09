export function parseByteRange(range: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2]) || size <= 0) return null;
  const first = match[1] ? Number(match[1]) : null;
  const last = match[2] ? Number(match[2]) : null;
  if (
    (first != null && !Number.isSafeInteger(first)) ||
    (last != null && !Number.isSafeInteger(last)) ||
    (first == null && !last)
  )
    return null;
  const start = first ?? Math.max(0, size - last!);
  const end =
    first != null && last != null ? Math.min(last, size - 1) : size - 1;
  return start <= end && start < size ? { start, end } : null;
}
