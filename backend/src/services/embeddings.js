/**
 * nomic-embed-text was trained with task prefixes; using them noticeably improves retrieval.
 * Other embedding models do not need them, so they are only applied to nomic models.
 */
export function usesTaskPrefixes(model) {
  return /nomic-embed/i.test(model);
}

export const DOCUMENT_PREFIX = 'search_document: ';
export const QUERY_PREFIX = 'search_query: ';

export function prepareDocumentInputs(model, texts) {
  return usesTaskPrefixes(model) ? texts.map((t) => DOCUMENT_PREFIX + t) : texts;
}

export function prepareQueryInput(model, text) {
  return usesTaskPrefixes(model) ? QUERY_PREFIX + text : text;
}
