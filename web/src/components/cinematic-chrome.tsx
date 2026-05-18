"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { HeroVideoBg } from "@/components/parts/hero-video-bg";
import { SiteHeader } from "@/components/site-header";
import { GlassFilter } from "@/components/glass-filter";

export type CinematicMode = "bright" | "dim";

type Ctx = {
  mode: CinematicMode;
  setMode: (m: CinematicMode) => void;
};

const CinematicModeContext = createContext<Ctx>({
  mode: "dim",
  setMode: () => {},
});

/**
 * Mounted ONCE at the root layout. Renders the video bg + glass header
 * that persist across page/state changes — that way the bg crossfades
 * smoothly between bright (landing) and dim (in-app) without flicker.
 *
 * Pages opt into a mode via `useSetCinematicMode("bright")` or via the
 * `<CinematicShell mode>` wrapper.
 */
export function CinematicChrome({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<CinematicMode>("dim");
  return (
    <CinematicModeContext.Provider value={{ mode, setMode }}>
      <GlassFilter />
      <HeroVideoBg mode={mode} />
      <SiteHeader variant="glass" />
      <div className="relative z-20 flex min-h-screen w-full flex-col">
        {children}
      </div>
    </CinematicModeContext.Provider>
  );
}

export function useCinematicMode() {
  return useContext(CinematicModeContext);
}

/** Set the cinematic mode for the lifetime of the calling component. */
export function useSetCinematicMode(mode: CinematicMode) {
  const { setMode } = useContext(CinematicModeContext);
  useEffect(() => {
    setMode(mode);
  }, [mode, setMode]);
}
