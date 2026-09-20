import { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { aiService } from "../services/aiService";

const DEFAULT_QUOTE = "Begin each day with a Grateful Heart.";

export default function PersonalizedHeroBanner() {
  const { user } = useAuth();
  const [aiQuote, setAiQuote] = useState(DEFAULT_QUOTE);

  const preferredQuote = (user?.dashboardQuote || "").trim();
  const displayQuote = preferredQuote ? preferredQuote.slice(0, 72) : aiQuote;

  useEffect(() => {
    let alive = true;

    if (preferredQuote) {
      return undefined;
    }

    aiService
      .getRandomMotivationalQuote(user?.name?.split(" ")?.[0] || "Team")
      .then((quote) => {
        if (alive) setAiQuote(quote || DEFAULT_QUOTE);
      })
      .catch(() => {
        if (alive) setAiQuote(DEFAULT_QUOTE);
      });

    return () => {
      alive = false;
    };
  }, [preferredQuote, user?.name]);

  return (
    <div
      className="relative z-0 bg-black rounded-2xl overflow-hidden shadow-lg flex items-center"
      style={{ minHeight: "110px", maxHeight: "120px", height: "110px" }}
    >
      {/* Background image */}
      <img
        className="absolute inset-0 w-full h-full object-cover"
        src={user?.dashboardBannerUrl || "/leaf-background.jpg"}
        alt=""
      />
      {/* Cinematic gradient overlay: solid on the left, transparent on the right */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to right, rgba(0,0,0,0.65) 0%, rgba(0,0,0,0.30) 55%, rgba(0,0,0,0) 100%)",
        }}
      />
      <div className="relative z-10 px-6 py-4 md:px-10 text-primary-foreground flex flex-row justify-between items-center w-full gap-4">
        <div>
          <h1 className="text-xl md:text-2xl font-black tracking-tight leading-tight">
            Hi {user?.name?.split(" ")[0] || "Team"},
          </h1>
          <p className="mt-0.5 font-medium text-sm text-primary-foreground/80">
            Good to see you back!
          </p>
        </div>
        <div className="hidden sm:block">
          <p className="text-xs md:text-sm text-right text-primary-foreground/85 font-medium leading-relaxed max-w-xs">
            {displayQuote}
          </p>
        </div>
      </div>
    </div>
  );
}
