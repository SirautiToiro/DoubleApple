import { createContext } from "react";

export type Mode = "edit" | "confirm" | "insert";

export const ModeContext = createContext<Mode>("edit");
