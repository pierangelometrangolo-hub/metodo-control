import { ReactNode } from "react";

type AppCardProps = {
  title?: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  // "compact": shell della UX Foundation v2 - superficie piatta, bordo
  // neutro sottile, titolo piccolo. Il default resta quello storico.
  density?: "default" | "compact";
};

export function AppCard({
  title,
  subtitle,
  action,
  children,
  className = "",
  density = "default",
}: AppCardProps) {
  if (density === "compact") {
    return (
      <section
        className={`rounded-[8px] border border-mc-border bg-mc-surface p-3.5 ${className}`}
      >
        {(title || subtitle || action) && (
          <div className="mb-2.5 flex items-start justify-between gap-4">
            <div>
              {title && <h2 className="text-[15px] font-semibold leading-tight text-mc-text">{title}</h2>}

              {subtitle && <p className="mt-0.5 text-[12px] leading-4 text-mc-text-secondary">{subtitle}</p>}
            </div>

            {action && <div>{action}</div>}
          </div>
        )}

        <div>{children}</div>
      </section>
    );
  }

  return (
    <section
      className={`rounded-[20px] border border-[#e7dfd8] bg-white p-6 shadow-[0_12px_30px_rgba(43,45,47,0.05)] ${className}`}
    >
      {(title || subtitle || action) && (
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            {title && (
              <h2 className="text-2xl text-[#2B2D2F]">
                {title}
              </h2>
            )}

            {subtitle && (
              <p className="mt-2 text-sm text-[#555555]">
                {subtitle}
              </p>
            )}
          </div>

          {action && <div>{action}</div>}
        </div>
      )}

      <div>{children}</div>
    </section>
  );
}