import { Button } from "@/components/ui/button";
﻿function PrimaryButton({ onClick, label = "Button", className = "" }) {
  const BASE_STYLES =
    "bg-red-9 text-primary-foreground rounded-lg  hover:bg-red-7 transition-all px-12 py-3";
  return (
    <Button type="submit" onClick={onClick} variant="ghost" className={`h-auto ${BASE_STYLES} ${className}`}>
      {label}
    </Button>
  );
}

export default PrimaryButton;
