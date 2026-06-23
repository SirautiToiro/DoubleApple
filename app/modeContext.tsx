import { createContext } from "react";

export type Mode = "edit" | "match";

export const ModeContext = createContext<Mode>("edit");
