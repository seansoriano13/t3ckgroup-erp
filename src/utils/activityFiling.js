/**
 * Who may file which Activity type (#1063). The same rule the database enforces in activity_can_file():
 * anyone may file a Meeting; only a department head may file an Admin Task, an Operations Task or an Event.
 * #1064 moves the rule into Activity settings. Plain functions, so the form, the New button and the side
 * menu all read one place.
 */
export const ACTIVITY_TYPES = ['MEETING', 'ADMIN_TASK', 'OPERATIONS_TASK', 'EVENT'];

const HEAD_ONLY = new Set(['ADMIN_TASK', 'OPERATIONS_TASK', 'EVENT']);

const isHead = (user) => Boolean(user?.is_head || user?.isHead);

export function canFileActivityType(user, activityType) {
  if (!user?.id) return false;
  if (activityType === 'MEETING') return true;
  return HEAD_ONLY.has(activityType) && isHead(user);
}

/** The types the viewer may file, in the usual order. */
export function fileableActivityTypes(user) {
  return ACTIVITY_TYPES.filter((t) => canFileActivityType(user, t));
}

/**
 * The types the form offers. An edit may keep the Activity's own type even when the viewer could not
 * file it today (an Admin Task a non-head filed earlier), but never offers a type the viewer cannot file.
 */
export function formTypeOptions(user, editingType = null) {
  return ACTIVITY_TYPES.filter((t) => t === editingType || canFileActivityType(user, t));
}

/** "New Meeting" when Meeting is the only type the viewer may file, "New Activity" when there are more. */
export function newActivityLabel(user) {
  return fileableActivityTypes(user).length === 1 ? 'New Meeting' : 'New Activity';
}
