/** A database numeric as a number, or null when it is blank (null, undefined or ""): a blank is never zero. */
export const numberOrNull = (value) => (value === null || value === undefined || value === "" ? null : Number(value));
