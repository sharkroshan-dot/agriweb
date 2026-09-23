import {
  applyParamPatch,
  buildHref,
  getBoolParam,
  getNumberParam,
  parseQueryString,
  toQueryString,
} from "./query-state";

describe("parseQueryString", () => {
  it("parses a query string into a flat map", () => {
    expect(parseQueryString("?q=apple&page=2&organic=true")).toEqual({
      q: "apple",
      page: "2",
      organic: "true",
    });
  });

  it("handles a missing leading '?' and empty input", () => {
    expect(parseQueryString("q=apple")).toEqual({ q: "apple" });
    expect(parseQueryString("")).toEqual({});
  });
});

describe("toQueryString", () => {
  it("serializes params without a leading '?'", () => {
    expect(toQueryString({ q: "apple", page: "2" })).toBe("q=apple&page=2");
  });

  it("drops empty/undefined/null values so cleared params vanish from the URL", () => {
    expect(toQueryString({ q: "", organic: undefined, page: null as any, sort: "asc" })).toBe(
      "sort=asc",
    );
  });

  it("returns an empty string when there is nothing to serialize", () => {
    expect(toQueryString({})).toBe("");
  });
});

describe("applyParamPatch", () => {
  it("merges the patch into the current params", () => {
    expect(applyParamPatch({ q: "apple" }, { page: "2" })).toEqual({
      q: "apple",
      page: "2",
    });
  });

  it("removes a key when the patch value is empty", () => {
    expect(applyParamPatch({ q: "apple", organic: "true" }, { organic: "" })).toEqual({
      q: "apple",
    });
  });

  it("removes reset keys", () => {
    expect(
      applyParamPatch({ q: "apple", page: "3" }, { category: "veg" }, ["page"]),
    ).toEqual({ q: "apple", category: "veg" });
  });

  it("returns null when nothing changes", () => {
    expect(applyParamPatch({ q: "apple" }, { q: "apple" })).toBeNull();
    expect(applyParamPatch({}, {})).toBeNull();
  });
});

describe("buildHref", () => {
  it("builds a full href with query params", () => {
    expect(buildHref("/search", { q: "apple", page: "2" })).toBe("/search?q=apple&page=2");
  });

  it("omits the query string when empty", () => {
    expect(buildHref("/nearby", {})).toBe("/nearby");
  });
});

describe("getNumberParam / getBoolParam", () => {
  it("returns a clamped numeric param with fallback", () => {
    expect(getNumberParam({ page: "7" }, "page", 1)).toBe(7);
    expect(getNumberParam({ page: "99" }, "page", 1, { min: 1, max: 10 })).toBe(10);
    expect(getNumberParam({ page: "abc" }, "page", 1)).toBe(1);
    expect(getNumberParam({}, "page", 1)).toBe(1);
  });

  it("reads boolean params", () => {
    expect(getBoolParam({ organic: "true" }, "organic")).toBe(true);
    expect(getBoolParam({ organic: "false" }, "organic")).toBe(false);
    expect(getBoolParam({}, "organic", true)).toBe(true);
  });
});
