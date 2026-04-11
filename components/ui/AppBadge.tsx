type AppBadgeProps = {
  children: React.ReactNode;
  variant?: "info" | "success" | "warning" | "danger" | "neutral";
  uppercase?: boolean;
  className?: string;
};

export function AppBadge({
  children,
  variant = "info",
  uppercase = false,
  className = "",
}: AppBadgeProps) {
  const variants = {
    info: "border-[#dbe8eb] bg-[#f3f8fa] text-[#017A92]",
    success: "border-[#d7eadf] bg-[#eef7f4] text-[#256a4b]",
    warning: "border-[#f0dfbf] bg-[#fff7eb] text-[#8a5a12]",
    danger: "border-[#eccfcf] bg-[#fbeeee] text-[#993333]",
    neutral: "border-[#e7dfd8] bg-[#fcfbf9] text-[#2B2D2F]",
  };

  return (
    <span
      className={`inline-flex w-fit rounded-full border px-3 py-1 text-xs font-semibold ${
        uppercase ? "uppercase tracking-[0.18em]" : ""
      } ${variants[variant]} ${className}`}
    >
      {children}
    </span>
  );
}