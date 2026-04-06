/**
 * Search index builder — creates document collections for search.
 */

function buildIndex(rawDocs) {
  return rawDocs.map((doc, i) => ({
    id: doc.id || `doc-${i}`,
    title: doc.title || '',
    content: doc.content || '',
    tags: doc.tags || [],
    created: doc.created || new Date().toISOString()
  }));
}

function generateTestDocuments(count, wordsPerDoc) {
  const vocabulary = [
    'the', 'quick', 'brown', 'fox', 'jumps', 'over', 'lazy', 'dog',
    'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta',
    'data', 'system', 'network', 'cloud', 'server', 'client', 'api', 'cache',
    'search', 'index', 'query', 'result', 'score', 'rank', 'filter', 'sort',
    'user', 'admin', 'config', 'deploy', 'build', 'test', 'debug', 'release',
    'memory', 'disk', 'cpu', 'thread', 'process', 'queue', 'stack', 'heap'
  ];

  const docs = [];
  for (let i = 0; i < count; i++) {
    const words = [];
    for (let j = 0; j < wordsPerDoc; j++) {
      words.push(vocabulary[Math.floor(Math.random() * vocabulary.length)]);
    }
    docs.push({
      id: `doc-${i}`,
      title: `Document ${i}`,
      content: words.join(' ')
    });
  }
  return docs;
}

module.exports = { buildIndex, generateTestDocuments };
