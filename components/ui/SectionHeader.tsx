type SectionHeaderProps = {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
};

export function SectionHeader({
  title,
  description,
  action,
  className = "",
}: SectionHeaderProps) {
  return (
    <div
      className={`flex flex-col gap-4 md:flex-row md:items-end md:justify-between ${className}`}
    >
      <div>
        <h2 className="font-serif text-[28px] leading-[32px] tracking-[-0.02em] text-[#2B2D2F]">
          {title}
        </h2>

        {description && (
          <p className="mt-2 text-sm leading-6 text-[#666666]">
            {description}
          </p>
        )}
      </div>

      {action && <div>{action}</div>}
    </div>
  );
}