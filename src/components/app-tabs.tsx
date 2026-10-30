import { Link, useLocation } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export function AppTabs() {
  const location = useLocation();
  const params = new URLSearchParams(location.searchStr);
  const selected = location.pathname === "/" ? (params.get("tab") ?? "scripts") : "buyer";
  return (
    <nav aria-label="Main tabs" className="border-b border-border bg-background text-foreground">
      <div className="mx-auto flex max-w-6xl flex-wrap gap-1 px-4 py-2">
        {(["scripts", "discord", "api"] as const).map((tab) => (
          <Button key={tab} variant={selected === tab ? "secondary" : "ghost"} size="sm" asChild>
            <Link to="/" search={{ tab }} aria-current={selected === tab ? "page" : undefined}>
              {tab === "scripts" ? "Scripts" : tab === "discord" ? "Discord" : "API keys"}
            </Link>
          </Button>
        ))}
        <Button variant={location.pathname === "/redeem" ? "secondary" : "ghost"} size="sm" asChild>
          <Link to="/redeem" aria-current={location.pathname === "/redeem" ? "page" : undefined}>Buyer portal</Link>
        </Button>
      </div>
    </nav>
  );
}