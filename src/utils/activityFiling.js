import { ACTIVITY_TYPE_KEYS, getActivitySettings } from './activitySettings';

/**
 * Who may file which Activity type (#1063, #1064). The same rule the database enforces in activity_can_file()
 * and activity_settings_check(), read from Settings > Activities: a type that is on, filed by everyone or only
 * by a department head. Plain functions, so the form, the New button and the side menu all read one place.
 * Pass `settings` to use a read you already hold; otherwise the app's current settings are used.
 */
export const ACTIVITY_TYPES = ACTIVITY_TYPE_KEYS;

const isHead = (user) => Boolean(user?.is_head || user?.isHead);

export function canFileActivityType(user, activityType, settings = getActivitySettings()) {
  if (!user?.id) return false;
  const rule = settings.types[activityType];
  if (!rule?.active) return false;
  return rule.whoFiles === 'EVERYONE' || isHead(user);
}

/** The types the viewer may file, in the usual order. */
export function fileableActivityTypes(user, settings = getActivitySettings()) {
  return ACTIVITY_TYPES.filter((t) => canFileActivityType(user, t, settings));
}

/**
 * The types the form offers. An edit may keep the Activity's own type even when the viewer could not
 * file it today (a type switched off, or an Admin Task a non-head filed earlier), but never offers another
 * type the viewer cannot file.
 */
export function formTypeOptions(user, editingType = null, settings = getActivitySettings()) {
  return ACTIVITY_TYPES.filter((t) => t === editingType || canFileActivityType(user, t, settings));
}

/** "New Meeting" when one type is the only one the viewer may file, "New Activity" when there are more. */
export function newActivityLabel(user, settings = getActivitySettings()) {
  const types = fileableActivityTypes(user, settings);
  return types.length === 1 ? `New ${settings.types[types[0]].name}` : 'New Activity';
}
