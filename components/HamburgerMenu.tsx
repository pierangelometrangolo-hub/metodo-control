"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const menuItems = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Operations", href: "/operations" },
  { label: "Time Tracking", href: "/time-tracking" },
  { label: "Performance", href: "/performance" },
  { label: "CRM", href: "/crm" },
  { label: "Finance", href: "/finance" },
  { label: "Projects", href: "/projects" },
];

function isActivePath(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function HamburgerMenu() {
  const [menuOpen, setMenuOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    if (!menuOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };

    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  return (
    <>
      <div className="flex items-center justify-end">
        <button
          onClick={() => setMenuOpen(true)}
          className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#e7dfd8] bg-white text-[#2B2D2F] transition hover:bg-[#f8f6f2]"
        >
          <div className="flex flex-col gap-[4px]">
            <span className="block h-[2px] w-5 bg-current" />
            <span className="block h-[2px] w-5 bg-current" />
            <span className="block h-[2px] w-5 bg-current" />
          </div>
        </button>
      </div>

      {/* OVERLAY */}
      <div
        className={`fixed inset-0 z-50 bg-black/30 backdrop-blur-[1px] transition-opacity duration-200 ${
          menuOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setMenuOpen(false)}
      />

      {/* DRAWER */}
      <aside
        className={`fixed right-0 top-0 z-[60] flex h-screen w-[300px] flex-col border-l border-[#e7dfd8] bg-[#f5f3ef] transform transition-transform duration-300 ${
          menuOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* HEADER */}
        <div className="flex h-16 items-center justify-between border-b border-[#e7dfd8] px-5">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#017A92]">
              MeToDo Control
            </p>
            <h2 className="text-sm font-semibold text-[#2B2D2F]">
              Navigation
            </h2>
          </div>

          <button
            onClick={() => setMenuOpen(false)}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#e7dfd8] bg-white text-[#6a6d70] hover:bg-[#f8f6f2]"
          >
            ✕
          </button>
        </div>

        {/* MENU */}
        <nav className="flex-1 px-3 py-4">
          <ul className="space-y-1">
            {menuItems.map((item) => {
              const isActive = isActivePath(pathname, item.href);

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setMenuOpen(false)}
                    className={[
                      "flex h-11 items-center rounded-lg px-3 text-sm transition",
                      isActive
                        ? "bg-white text-[#017A92] border border-[#e7dfd8]"
                        : "text-[#4f5254] hover:bg-white",
                    ].join(" ")}
                  >
                    <span
                      className={`mr-2 h-[14px] w-[2px] rounded-full ${
                        isActive ? "bg-[#017A92]" : "bg-transparent"
                      }`}
                    />

                    <span
                      className={
                        isActive ? "font-semibold" : "font-medium"
                      }
                    >
                      {item.label}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* FOOTER */}
        <div className="border-t border-[#e7dfd8] px-3 py-3">
          <Link
            href="/"
            onClick={() => setMenuOpen(false)}
            className="flex h-11 items-center rounded-lg px-3 text-sm font-medium text-[#8a3a3a] hover:bg-white"
          >
            Logout
          </Link>
        </div>
      </aside>
    </>
  );
}