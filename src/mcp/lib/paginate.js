export function paginate(items, limit, offset) {
  const total = items.length;
  const start = Math.min(offset, total);
  const end = Math.min(start + limit, total);
  return {
    total,
    has_more: end < total,
    results: items.slice(start, end),
  };
}
