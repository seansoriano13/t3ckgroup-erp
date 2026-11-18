import { useQuery } from '@tanstack/react-query';
import { activitySettingsService } from '@/services/activitySettingsService';
import { applyActivityTypeNames } from '@/services/meetingRequestService';
import { applyActivityTypeStyles } from '@/components/calendar/entryKinds.jsx';
import { DEFAULT_ACTIVITY_SETTINGS, getActivitySettings, setActivitySettings } from '@/utils/activitySettings';

export const ACTIVITY_SETTINGS_KEY = ['activity-settings'];

/**
 * The Activity settings (#1064), read once and shared. Until the first read, or when it fails, the app keeps the
 * defaults (today's rules). Each read also hands the names and colours to the places that draw them (the Calendar,
 * the filter, the form), so a rename or a new colour shows everywhere without each screen asking.
 */
export function useActivitySettings() {
  const { data } = useQuery({
    queryKey: ACTIVITY_SETTINGS_KEY,
    queryFn: () => activitySettingsService.get(),
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
  });
  const settings = data ?? DEFAULT_ACTIVITY_SETTINGS;
  // Applied while rendering, so this component's children already draw the new names and colours.
  if (getActivitySettings() !== settings && data) {
    setActivitySettings(settings);
    applyActivityTypeNames(settings.types);
    applyActivityTypeStyles(settings.types);
  }
  return settings;
}
