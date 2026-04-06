/**
 * Search engine — full-text search across document collection.
 * Scores documents by term frequency matching.
 */

function search(query, documents) {
  if (!query || !documents || documents.length === 0) return [];

  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];

  const results = [];

  for (const doc of documents) {
    let score = 0;
    const content = doc.content || '';

    for (const term of terms) {
      // BUG: re-splitting the document content for EVERY term creates O(terms * words) work
      // per document, making the total complexity O(docs * terms * words)
      const words = content.toLowerCase().split(/\s+/);
      for (const word of words) {
        if (word === term) score++;
      }
    }

    if (score > 0) {
      results.push({ id: doc.id, title: doc.title || '', score });
    }
  }

  return results.sort((a, b) => b.score - a.score);
}

function searchWithLimit(query, documents, limit) {
  const results = search(query, documents);
  return results.slice(0, limit);
}

module.exports = { search, searchWithLimit };
