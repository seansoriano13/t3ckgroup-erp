import { createContext, useContext } from "react";

/**
 * The Canvass a Purchase Request window was opened from, as `{ canvassId, close }`. The request's
 * link to that same Canvass then goes back to it (`close`) instead of opening it again on top of itself.
 */
export const CanvassOrigin = createContext(null);
export const useCanvassOrigin = () => useContext(CanvassOrigin);
