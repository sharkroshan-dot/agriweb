import { getListingLabel, isListingPath } from "./listing-routes";

describe("listing-routes", () => {
  it("recognizes all marketplace/listing routes", () => {
    for (const path of [
      "/nearby",
      "/search",
      "/marketplace",
      "/marketplace/state",
      "/marketplace/national",
      "/marketplace/community",
      "/farmers",
    ]) {
      expect(isListingPath(path)).toBe(true);
    }
  });

  it("rejects non-listing routes", () => {
    expect(isListingPath("/product/abc")).toBe(false);
    expect(isListingPath("/cart")).toBe(false);
    expect(isListingPath("/")).toBe(false);
  });

  it("returns a friendly label per route", () => {
    expect(getListingLabel("/nearby")).toBe("Nearby Markets");
    expect(getListingLabel("/marketplace/state")).toBe("State Marketplace");
    expect(getListingLabel("/unknown")).toBe("Back");
  });
});
