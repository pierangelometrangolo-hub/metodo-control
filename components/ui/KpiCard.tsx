import Link from "next/link";

type KpiCardProps = {
  title: string;
  value: string;
  note: string;
  href: string;
  active?: boolean;
  alert?: boolean;
};

// Altezza fissa (non variabile in base al contenuto) cosi' la griglia
// resta uniforme anche quando "note" e' piu' lunga del solito - il
// contenuto in eccesso viene tagliato (overflow-hidden + line-clamp sulla
// nota), mai spinto oltre l'altezza della card.
export function KpiCard({
  title,
  value,
  note,
  href,
  active = false,
  alert = false,
}: KpiCardProps) {
  return (
    <Link
      href={href}
      className={`group relative flex h-[100px] flex-col overflow-hidden rounded-[14px] border p-3.5 transition duration-200 ${
        active
          ? "border-teal bg-[linear-gradient(180deg,#f5fbfc_0%,#eef7f9_100%)] shadow-[0_8px_20px_rgba(1,122,146,0.10)]"
          : "border-[#e7dfd8] bg-white shadow-[0_4px_12px_rgba(43,45,47,0.04)] hover:-translate-y-0.5 hover:shadow-[0_8px_20px_rgba(43,45,47,0.07)]"
      }`}
    >
      <div
        className={`mb-1.5 h-1 w-8 shrink-0 rounded-full ${
          alert ? "bg-terracotta" : "bg-teal"
        }`}
      />

      <p
        className={`shrink-0 truncate text-[10px] font-semibold uppercase tracking-[0.18em] ${
          alert ? "text-terracotta" : "text-teal"
        }`}
      >
        {title}
      </p>

      <p className="mt-0.5 shrink-0 truncate text-[26px] font-semibold leading-none tracking-[-0.02em] text-near-black">
        {value}
      </p>

      <p className="mt-1 line-clamp-2 text-[11px] leading-[1.25] text-[#666666]">{note}</p>
    </Link>
  );
}