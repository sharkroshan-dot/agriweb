describe("Search / filter state persistence", () => {
  it("keeps filters and pagination in the URL and restores them on reload", () => {
    cy.visit("/search?q=tomatoes");

    cy.get("select").filter((_i, el) => el.options[0]?.textContent?.includes("Relevance")).select("price-asc");
    cy.url().should("contain", "sortBy=price-asc");

    cy.reload();
    cy.url().should("contain", "q=tomatoes");
    cy.url().should("contain", "sortBy=price-asc");
  });

  it("preserves the organic filter through a refresh", () => {
    cy.visit("/search");

    // Toggle the organic-only switch (checkbox role on the desktop sidebar).
    cy.get('[role="checkbox"]').first().click();
    cy.url().should("contain", "organic=true");

    cy.reload();
    cy.url().should("contain", "organic=true");
  });

  it("restores the page number after a refresh", () => {
    cy.visit("/search?q=mango&page=3");
    cy.contains("Page 3 of").should("be.visible");
    cy.reload();
    cy.contains("Page 3 of").should("be.visible");
  });
});

describe("Product details Back navigation", () => {
  it("returns to the exact marketplace listing the user came from", () => {
    cy.visit("/marketplace/state?sort=price-asc");
    cy.get('a[href*="/product/"]').first().click();

    cy.contains("Back to State Marketplace").should("be.visible");
    cy.contains("Back to State Marketplace").click();

    cy.url().should("contain", "/marketplace/state");
    cy.url().should("contain", "sort=price-asc");
  });

  it("falls back to the default marketplace on a deep link", () => {
    cy.visit("/product/tomatoes-01");
    cy.contains("Back to Nearby Markets").should("be.visible");
  });
});
