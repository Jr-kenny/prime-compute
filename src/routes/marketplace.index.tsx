import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Search, Filter as FilterIcon } from "lucide-react";
import confetti from "canvas-confetti";
import { ProviderCard } from "@/components/site/ProviderCard";
import { RentSheet } from "@/components/site/RentSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetFooter,
} from "@/components/ui/sheet";
import type { Provider, ResourceType } from "@services/domain";
import { listProviders, createRent } from "@/lib/broker/server-fns";
import { supabaseBrowser } from "@/lib/supabase/client";

export const Route = createFileRoute("/marketplace/")({
  loader: () => listProviders(),
  component: MarketplaceIndex,
});

const allTypes: ResourceType[] = ["GPU", "CPU", "Storage"];

function MarketplaceIndex() {
  const providers = Route.useLoaderData();
  const [q, setQ] = useState("");
  const [types, setTypes] = useState<ResourceType[]>(["GPU", "CPU", "Storage"]);
  const [minScore, setMinScore] = useState(0);
  const [maxPrice, setMaxPrice] = useState(0.00003);
  const [availableOnly, setAvailableOnly] = useState(false);
  const [rentFor, setRentFor] = useState<Provider | null>(null);

  const filtered = useMemo(() => {
    return providers.filter((p) => {
      if (q && !p.alias.toLowerCase().includes(q.toLowerCase())) return false;
      if (!types.includes(p.resourceType as ResourceType) && p.resourceType !== "Full Server")
        return false;
      if (p.computeScore < minScore) return false;
      if (p.pricePerCharge > maxPrice) return false;
      if (availableOnly && !p.online) return false;
      return true;
    });
  }, [providers, q, types, minScore, maxPrice, availableOnly]);

  const toggleType = (t: ResourceType) =>
    setTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  return (
    <>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-10">
        <header className="flex flex-wrap items-end justify-between gap-4 mb-8">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-glow">Marketplace</div>
            <h1 className="mt-1 text-3xl md:text-4xl font-bold">Compute Marketplace</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {filtered.length} providers match your filters
            </p>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search providers..."
                className="pl-9 bg-surface/60 border-border"
              />
            </div>
          </div>
        </header>

        <div className="grid lg:grid-cols-[260px_1fr] gap-8">
          <aside className="hidden lg:block">
            <FiltersPanel
              types={types}
              toggleType={toggleType}
              minScore={minScore}
              setMinScore={setMinScore}
              maxPrice={maxPrice}
              setMaxPrice={setMaxPrice}
              availableOnly={availableOnly}
              setAvailableOnly={setAvailableOnly}
            />
          </aside>

          <div>
            <div className="lg:hidden mb-4">
              <Sheet>
                <SheetTrigger asChild>
                  <Button variant="ghost" className="border border-border w-full">
                    <FilterIcon className="h-4 w-4" /> Filters
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="bg-surface border-border">
                  <SheetHeader>
                    <SheetTitle>Filters</SheetTitle>
                  </SheetHeader>
                  <div className="mt-6">
                    <FiltersPanel
                      types={types}
                      toggleType={toggleType}
                      minScore={minScore}
                      setMinScore={setMinScore}
                      maxPrice={maxPrice}
                      setMaxPrice={setMaxPrice}
                      availableOnly={availableOnly}
                      setAvailableOnly={setAvailableOnly}
                    />
                  </div>
                </SheetContent>
              </Sheet>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {filtered.map((p) => (
                <ProviderCard key={p.id} p={p} onRent={(prov) => setRentFor(prov)} />
              ))}
              {filtered.length === 0 && (
                <div className="col-span-full glass-card p-10 text-center text-muted-foreground">
                  No providers match. Loosen your filters.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <RentSheet provider={rentFor} onClose={() => setRentFor(null)} />
    </>
  );
}

function FiltersPanel({
  types,
  toggleType,
  minScore,
  setMinScore,
  maxPrice,
  setMaxPrice,
  availableOnly,
  setAvailableOnly,
}: {
  types: ResourceType[];
  toggleType: (t: ResourceType) => void;
  minScore: number;
  setMinScore: (n: number) => void;
  maxPrice: number;
  setMaxPrice: (n: number) => void;
  availableOnly: boolean;
  setAvailableOnly: (v: boolean) => void;
}) {
  return (
    <div className="space-y-6 glass-card p-5">
      <div>
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          Resource type
        </Label>
        <div className="mt-3 space-y-2">
          {allTypes.map((t) => (
            <label
              key={t}
              className="flex items-center gap-2 text-sm text-foreground cursor-pointer"
            >
              <Checkbox checked={types.includes(t)} onCheckedChange={() => toggleType(t)} />
              {t}
            </label>
          ))}
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Min compute score
          </Label>
          <span className="text-xs text-foreground">{minScore}</span>
        </div>
        <Slider
          className="mt-3"
          value={[minScore]}
          min={0}
          max={100}
          step={1}
          onValueChange={(v) => setMinScore(v[0])}
        />
      </div>
      <div>
        <div className="flex items-center justify-between">
          <Label className="text-xs uppercase tracking-wider text-muted-foreground">
            Max $/sec
          </Label>
          <span className="text-xs text-foreground">${maxPrice.toFixed(7)}</span>
        </div>
        <Slider
          className="mt-3"
          value={[maxPrice]}
          min={0.000001}
          max={0.00003}
          step={0.0000005}
          onValueChange={(v) => setMaxPrice(v[0])}
        />
      </div>
      <div className="flex items-center justify-between">
        <Label className="text-sm">Available now only</Label>
        <Switch checked={availableOnly} onCheckedChange={setAvailableOnly} />
      </div>
    </div>
  );
}
