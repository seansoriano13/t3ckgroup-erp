import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, MapPin, Plus, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/context/AuthContext";
import { meetingRequestService } from "@/services/meetingRequestService";

/** Settings > Venues (#626): add, rename, reorder, switch off or on, and delete a Venue that has no requests. */
export default function VenueManager() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState("");

  const { data: venues = [], isLoading } = useQuery({
    queryKey: ["calendar-venues", "all"],
    queryFn: () => meetingRequestService.listVenues({ includeInactive: true }),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["calendar-venues"] });
  const onError = (err) => toast.error(err.message);
  const change = useMutation({ mutationFn: (run) => run(), onSuccess: refresh, onError });

  const add = (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    change.mutate(async () => {
      await meetingRequestService.addVenue(newName, user?.id);
      setNewName("");
      toast.success("Venue added.");
    });
  };

  const move = (index, step) => {
    const next = [...venues];
    const [item] = next.splice(index, 1);
    next.splice(index + step, 0, item);
    change.mutate(() => meetingRequestService.reorderVenues(next, user?.id));
  };

  const rename = (venue, value) => {
    const name = value.trim();
    if (!name || name === venue.name) return;
    change.mutate(() => meetingRequestService.renameVenue(venue, name, user?.id));
  };

  return (
    <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-border bg-muted/30 flex items-center gap-2.5">
        <div className="w-6 h-6 rounded-lg bg-muted flex items-center justify-center">
          <MapPin size={14} className="text-muted-foreground" />
        </div>
        <h2 className="text-sm font-semibold text-foreground">Venues</h2>
      </div>
      <div className="p-5 space-y-4">
        <p className="text-xs text-muted-foreground leading-relaxed">
          A Venue that is switched off is not offered in the Meeting Request form and has no column in the day view. It still shows on
          its existing meetings. A Venue that has any request can only be switched off, not deleted.
        </p>
        <form onSubmit={add} className="flex gap-2">
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New Venue name" aria-label="New Venue name" />
          <Button type="submit" disabled={!newName.trim() || change.isPending}>
            <Plus size={14} /> Add
          </Button>
        </form>
        {isLoading ? null : (
          <ul className="divide-y divide-border border border-border rounded-xl">
            {venues.map((venue, i) => (
              <li key={venue.id} className="flex items-center gap-2 p-3">
                <div className="flex flex-col">
                  <Button variant="ghost" size="icon" className="h-5 w-6" disabled={i === 0 || change.isPending} onClick={() => move(i, -1)} aria-label={`Move ${venue.name} up`}>
                    <ChevronUp size={14} />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-5 w-6" disabled={i === venues.length - 1 || change.isPending} onClick={() => move(i, 1)} aria-label={`Move ${venue.name} down`}>
                    <ChevronDown size={14} />
                  </Button>
                </div>
                <Input
                  key={venue.name}
                  defaultValue={venue.name}
                  aria-label={`Name of ${venue.name}`}
                  onBlur={(e) => rename(venue, e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  className="flex-1"
                />
                <span className="text-xs text-muted-foreground w-10 text-right">{venue.active ? "On" : "Off"}</span>
                <Switch
                  checked={venue.active}
                  disabled={change.isPending}
                  aria-label={`${venue.name} is on`}
                  onCheckedChange={(on) => change.mutate(() => meetingRequestService.setVenueActive(venue, on, user?.id))}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Delete ${venue.name}`}
                  disabled={change.isPending}
                  onClick={() =>
                    change.mutate(async () => {
                      await meetingRequestService.deleteVenue(venue, user?.id);
                      toast.success("Venue deleted.");
                    })
                  }
                >
                  <Trash2 size={14} />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
