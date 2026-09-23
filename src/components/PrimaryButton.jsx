import { Button } from "@/components/ui/button";

function PrimaryButton({ onClick, label = "Button", className = "" }) {
  const BASE_STYLES = "h-auto bg-red-9 text-primary-foreground hover:bg-red-7 px-12 py-3";
  return (
    <Button onClick={onClick} className={`${BASE_STYLES} ${className}`}>
      {label}
    </Button>
  );
}

export default PrimaryButton;
