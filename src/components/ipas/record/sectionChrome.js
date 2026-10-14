// How `IpasSection` frames itself. The drawer sets this to "bare" because the
// drawer's own header already names the section (number, title, state), so the
// card frame and title are not drawn twice.

import { createContext } from "react";

export const IpasSectionChrome = createContext("card");
