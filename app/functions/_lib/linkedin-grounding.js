// Endorsements belong to their authors. A paraphrase must never become a quotation.
export function preserveRecommendationText(section, original) {
  if (section && typeof section === 'object') section.optimizedText = String(original || '').trim();
  return section;
}
