import { useEffect, useState } from "react";
import { Image } from "@/components/ui/image";
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
      className="relative z-0 flex h-14 items-center overflow-hidden rounded-2xl bg-black shadow-lg md:h-[110px] md:max-h-[120px] md:min-h-[110px] laptop:h-14 laptop:max-h-14 laptop:min-h-0"
    >
      {/* Background image */}
      <Image
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
      <div className="relative z-10 flex w-full flex-row items-center justify-between gap-4 px-4 py-2 text-primary-foreground md:px-10 md:py-4 laptop:px-6 laptop:py-2">
        <div className="min-w-0 max-md:flex max-md:items-baseline max-md:gap-2 laptop:flex laptop:items-baseline laptop:gap-2">
          <h1 className="truncate text-base font-black leading-tight tracking-tight md:text-2xl laptop:text-lg">
            Hi {user?.name?.split(" ")[0] || "Team"},
          </h1>
          <p className="mt-0.5 hidden text-sm font-medium text-primary-foreground/80 md:block laptop:mt-0 laptop:text-xs">
            Good to see you back!
          </p>
        </div>
        <div className="hidden md:block">
          <p className="text-xs md:text-sm text-right text-primary-foreground/85 font-medium leading-relaxed max-w-xs">
            {displayQuote}
          </p>
        </div>
      </div>
    </div>
  );
}
