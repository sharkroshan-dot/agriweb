export function SiteFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-2 px-6 py-6 text-sm text-slate-500 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <p>(c) 2026 AgriConnect. Empowering farmers, buyers, and warehouses.</p>
        <div className="flex gap-4">
          <span>Real-time insights</span>
          <span>Mobile-first logistics</span>
          <span>AI-powered growth</span>
        </div>
      </div>
    </footer>
  );
}
