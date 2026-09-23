import Link from "next/link";

const links = [
  { href: "/", label: "Home" },
  { href: "/roadmap", label: "Roadmap" },
  { href: "/login", label: "Login" },
  { href: "/register", label: "Register" },
  { href: "/customer/dashboard", label: "Customers" },
  { href: "/farmer/dashboard", label: "Farmers" },
  { href: "/warehouse/dashboard", label: "Warehouses" },
];

export function SiteHeader() {
  return (
    <header className="border-b border-slate-200 bg-white/80 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 lg:px-8">
        <Link href="/" className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-600 text-lg font-semibold text-white">
            A
          </div>
          <div>
            <p className="text-lg font-semibold text-slate-900">AgriConnect</p>
            <p className="text-sm text-slate-500">Smart agri commerce</p>
          </div>
        </Link>
        <nav className="hidden items-center gap-6 text-sm font-medium text-slate-600 md:flex">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="transition hover:text-emerald-600">
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
