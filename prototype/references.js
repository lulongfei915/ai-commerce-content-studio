/* Shared keyword, category and media filtering. Browsing never changes a draft. */
window.filterReferenceEntries = function(entries, filters) {
  const query = (filters.search || '').trim().toLowerCase();
  return entries.filter(entry =>
    (!filters.category || filters.category === 'all' || entry.category === filters.category) &&
    (!filters.media || filters.media === 'all' || entry.media === filters.media) &&
    (!query || [entry.name, entry.tag, entry.category, entry.style, entry.features, entry.text].filter(Boolean).join(' ').toLowerCase().includes(query))
  );
};
