import Link from "next/link";

type KpiCardProps = {
  title: string;
  value: string;
  note: string;
  href: string;
  active?: boolean;
  alert?: boolean;
};

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
      className={`group relative overflow-hidden rounded-[20px] border p-5 transition duration-200 ${
        active
          ? "border-[#017A92] bg-[linear-gradient(180deg,#f5fbfc_0%,#eef7f9_100%)] shadow-[0_12px_30px_rgba(1,122,146,0.10)]"
          : "border-[#e7dfd8] bg-white shadow-[0_8px_20px_rgba(43,45,47,0.04)] hover:-translate-y-0.5 hover:shadow-[0_12px_30px_rgba(43,45,47,0.07)]"
      }`}
    >
      <div
        className={`mb-4 h-1.5 w-12 rounded-full ${
          alert ? "bg-[#993333]" : "bg-[#017A92]"
        }`}
      />

      <p
        className={`text-[11px] font-semibold uppercase tracking-[0.28em] ${
          alert ? "text-[#993333]" : "text-[#017A92]"
        }`}
      >
        {title}
      </p>

      <p className="mt-4 text-[42px] font-semibold leading-none tracking-[-0.03em] text-[#2B2D2F]">
        {value}
      </p>

      <p className="mt-3 text-sm leading-6 text-[#666666]">{note}</p>
    </Link>
  );
}