type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: React.ReactNode;
};

export function PageHeader({
  eyebrow,
  title,
  description,
  children,
}: PageHeaderProps) {
  return (
    <section className="overflow-hidden rounded-[24px] border border-[#e7dfd8] bg-white shadow-[0_12px_30px_rgba(43,45,47,0.05)]">
      <div className="grid md:grid-cols-[280px_1fr]">
        <div className="flex min-h-[240px] items-center justify-center bg-gradient-to-br from-[#1f6d7d] via-[#017A92] to-[#2B2D2F] p-8">
          <div className="flex h-[160px] w-[160px] items-center justify-center rounded-[24px] border border-white/20 bg-white/95 shadow-[0_12px_30px_rgba(43,45,47,0.18)] backdrop-blur">
            <img
              src="/images/metodo-logo.png"
              alt="MeToDo logo"
              className="h-[126px] w-auto object-contain"
            />
          </div>
        </div>

        <div className="flex flex-col justify-center p-8 md:p-10">
          {eyebrow && (
            <p className="text-[11px] font-semibold uppercase tracking-[0.34em] text-[#017A92]">
              {eyebrow}
            </p>
          )}

          <h1 className="mt-3 font-serif text-[42px] leading-[46px] tracking-[-0.03em] text-[#2B2D2F] md:text-[48px] md:leading-[52px]">
            {title}
          </h1>

          {description && (
            <p className="mt-5 max-w-3xl text-[16px] leading-8 text-[#5f6368]">
              {description}
            </p>
          )}

          {children && <div className="mt-6">{children}</div>}
        </div>
      </div>
    </section>
  );
}
