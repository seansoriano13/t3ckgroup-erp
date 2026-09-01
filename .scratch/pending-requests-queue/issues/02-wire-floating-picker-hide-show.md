# 02 — Wire up FLOATING_PICKER_HIDE / FLOATING_PICKER_SHOW

**What to build:** The floating period picker (the month/quarter/year selector shown on the HR and employee offsets pages) currently does not listen for the `FLOATING_PICKER_HIDE` and `FLOATING_PICKER_SHOW` window events, even though `ComprehensiveChatModal` already dispatches them when it opens and closes. The events go nowhere today — this is a live, independent bug: the picker presumably floats visibly over the chat modal.

This ticket makes the picker register a listener for both events and hide/show itself accordingly. This is valuable on its own (fixes the chat-modal overlap), and it is also the mechanism ticket 03 needs to hide the picker on the HR Pending tab — rather than inventing a second, parallel hide/show mechanism.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] The floating period picker registers a listener for `FLOATING_PICKER_HIDE` and hides itself when the event fires.
- [ ] The floating period picker registers a listener for `FLOATING_PICKER_SHOW` and shows itself again when the event fires.
- [ ] Opening the chat modal (which already dispatches `FLOATING_PICKER_HIDE`) now visibly hides the picker; closing it (`FLOATING_PICKER_SHOW`) brings it back.
- [ ] The picker's hide/show state does not leak between unrelated pages — e.g. hiding it from one consumer does not permanently hide it for others once shown again.
- [ ] No other existing behavior of the picker (mode switching, date range selection, callback firing) regresses.
