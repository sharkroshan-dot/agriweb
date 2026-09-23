// Reset browser storage between tests so persisted zustand stores start fresh.
beforeEach(() => {
  try {
    window.localStorage.clear();
    window.sessionStorage.clear();
  } catch {
    // jsdom may not expose storage before a document is ready
  }
});
