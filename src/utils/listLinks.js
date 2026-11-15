// Dashboard drill-downs link to a filtered list through the address, so a refresh,
// a new tab and a shared link keep the filter. Empty values are left out.
const withQuery = (path, params) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  const text = query.toString();
  return text ? `${path}?${text}` : path;
};

/** My Tasks, filtered by status and/or employee. */
export const tasksHref = ({ status, employee } = {}) => withQuery("/tasks", { status, employee });

/** The SOR Register, filtered by employee and/or stage. */
export const sorsHref = ({ employee, status } = {}) => withQuery("/sors", { employee, status });
