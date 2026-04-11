type AppButtonProps = {
  children: React.ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  href?: string;
  onClick?: () => void;
  className?: string;
};

export function AppButton({
  children,
  variant = "primary",
  href,
  onClick,
  className = "",
}: AppButtonProps) {
  const base =
    "inline-flex items-center justify-center rounded-[14px] px-4 py-2 text-sm font-semibold transition";

  const variants = {
    primary:
      "bg-[#017A92] text-white hover:opacity-90 shadow-[0_6px_16px_rgba(43,45,47,0.08)]",
    secondary:
      "bg-[#fcfbf9] border border-[#e7dfd8] text-[#2B2D2F] hover:bg-[#f7f3ee]",
    ghost:
      "text-[#017A92] hover:bg-[#f3f8fa]",
  };

  const classes = `${base} ${variants[variant]} ${className}`;

  if (href) {
    return (
      <a href={href} className={classes}>
        {children}
      </a>
    );
  }

  return (
    <button onClick={onClick} className={classes}>
      {children}
    </button>
  );
}