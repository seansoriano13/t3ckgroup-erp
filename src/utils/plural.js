/** "1 task", "3 tasks". Pass `plural` for irregular nouns. */
export const pluralize = (count, singular, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;
