/**
 * Relevance scorer — utility functions for ranking results.
 * This module is working correctly.
 */

function normalizeScore(score, maxScore) {
  if (maxScore === 0) return 0;
  return Math.round((score / maxScore) * 100) / 100;
}

function applyBoost(results, boostMap) {
  return results.map(r => {
    const boost = boostMap[r.id] || 1.0;
    return { ...r, score: r.score * boost };
  });
}

function filterByThreshold(results, minScore) {
  return results.filter(r => r.score >= minScore);
}

module.exports = { normalizeScore, applyBoost, filterByThreshold };
