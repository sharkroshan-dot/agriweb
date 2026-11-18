import { redirect } from "next/navigation";

type SearchParams = Record<string, string | string[] | undefined>;

// Keep old /search links working, but send customers to the unified marketplace.
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const marketplaceParams = new URLSearchParams();

  const copy = (from: string, to = from) => {
    const value = params[from];
    if (typeof value === "string" && value.trim()) {
      marketplaceParams.set(to, value);
    }
  };

  copy("q", "search");
  copy("category");
  copy("priceMin", "minPrice");
  copy("priceMax", "maxPrice");
  copy("sortBy");
  if (params.organic === "true" || params.category === "organic") {
    marketplaceParams.set("assurance", "organic");
    marketplaceParams.delete("category");
  }

  const query = marketplaceParams.toString();
  redirect(query ? `/marketplace?${query}` : "/marketplace");
}
