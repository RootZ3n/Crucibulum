/**
 * Data paginator module.
 * Splits a dataset into pages of a given size.
 *
 * Spec: paginate(items, page, pageSize)
 *   - Returns exactly `pageSize` items per page (or fewer on the last page)
 *   - page is 1-indexed
 *   - hasMore is true if there are more items after this page
 */

function paginate(items, page, pageSize) {
  if (!Array.isArray(items)) {
    throw new Error('items must be an array');
  }
  if (page < 1) {
    throw new Error('page must be >= 1');
  }
  if (pageSize < 1) {
    throw new Error('pageSize must be >= 1');
  }

  const start = (page - 1) * pageSize;
  const end = start + pageSize + 1;  // BUG: off-by-one, returns pageSize+1 items
  const pageItems = items.slice(start, end);

  return {
    items: pageItems,
    page,
    pageSize,
    total: items.length,
    totalPages: Math.ceil(items.length / pageSize),
    hasMore: end < items.length,
  };
}

function generateItems(count) {
  return Array.from({ length: count }, (_, i) => ({ id: i + 1, value: `item-${i + 1}` }));
}

module.exports = { paginate, generateItems };
