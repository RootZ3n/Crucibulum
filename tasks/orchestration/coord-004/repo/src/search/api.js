/**
 * Search API wrapper — provides a high-level search interface.
 */

const { search, searchWithLimit } = require('./engine');
const { normalizeScore, filterByThreshold } = require('./scorer');

function handleSearch(query, documents, options = {}) {
  const { limit = 10, minScore = 0 } = options;

  let results = searchWithLimit(query, documents, limit * 2);

  if (results.length > 0) {
    const maxScore = results[0].score;
    results = results.map(r => ({
      ...r,
      relevance: normalizeScore(r.score, maxScore)
    }));
  }

  if (minScore > 0) {
    results = filterByThreshold(results, minScore);
  }

  return results.slice(0, limit);
}

module.exports = { handleSearch };
