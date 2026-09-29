import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { appSettingsService } from "../services/appSettingsService";

const QUERY_KEY = ["appSettings"];

/**
 * The one reader of the system settings row. Defaults are already applied, so
 * callers never write a fallback. Updates are optimistic and roll back with an
 * error toast on failure.
 */
export function useAppSettings() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => appSettingsService.getAppSettings(),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  const mutation = useMutation({
    mutationFn: (payload) => appSettingsService.updateAppSettings(payload),
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const previous = queryClient.getQueryData(QUERY_KEY);
      queryClient.setQueryData(QUERY_KEY, (old) => appSettingsService.withDefaults({ ...old, ...payload }));
      return { previous };
    },
    onError: (err, _payload, context) => {
      // Nothing was cached before, so there is nothing to restore: the
      // onSettled refetch replaces the optimistic value with the stored one.
      if (context?.previous !== undefined) queryClient.setQueryData(QUERY_KEY, context.previous);
      toast.error(err.message || "Could not save the setting.");
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  });

  return {
    settings: data ?? appSettingsService.defaults,
    updateSetting: mutation.mutate,
    isPending: mutation.isPending,
    isLoading,
  };
}
