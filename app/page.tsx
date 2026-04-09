import Link from "next/link";

const modules = [
  {
    title: "Operations",
    description: "Task manager, assegnazioni, scadenze e controllo operativo.",
    href: "/operations",
  },
  {
    title: "Performance",
    description: "KPI, storico, confronto periodi e reportistica.",
    href: "#",
  },
  {
    title: "CRM",
    description: "Contatti, clienti, formazione e opportunità commerciali.",
    href: "#",
  },
  {
    title: "Finance",
    description: "Produzione, snapshot, budgeting e controllo economico.",
    href: "#",
  },
];

const pillars = [
  "Analisi",
  "Programmazione",
  "Pianificazione",
  "Azione",
  "Controllo",
];

export default function Home() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#0b0b0b",
        color: "#f5f5f5",
        fontFamily:
          'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      }}
    >
      <section
        style={{
          maxWidth: 1240,
          margin: "0 auto",
          padding: "40px 24px 80px",
        }}
      >
        <header
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 16,
            marginBottom: 56,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div
              style={{
                fontSize: 14,
                letterSpacing: "0.24em",
                textTransform: "uppercase",
                color: "#bdbdbd",
                marginBottom: 8,
              }}
            >
              MeToDo
            </div>
            <div
              style={{
                fontSize: 28,
                fontWeight: 700,
                letterSpacing: "-0.03em",
              }}
            >
              MeToDo Control
            </div>
          </div>

          <nav
            style={{
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <a
              href="#moduli"
              style={navLinkStyle}
            >
              Moduli
            </a>
            <a
              href="#metodo"
              style={navLinkStyle}
            >
              Metodo
            </a>
            <Link href="/operations" style={primaryButtonStyle}>
              Apri Operations
            </Link>
          </nav>
        </header>

        <section
          style={{
            display: "grid",
            gridTemplateColumns: "1.3fr 0.9fr",
            gap: 28,
            alignItems: "stretch",
          }}
        >
          <div
            style={{
              background:
                "linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 24,
              padding: 32,
            }}
          >
            <div
              style={{
                display: "inline-flex",
                padding: "8px 12px",
                borderRadius: 999,
                background: "rgba(255,255,255,0.08)",
                color: "#d6d6d6",
                fontSize: 13,
                marginBottom: 18,
              }}
            >
              Your next level
            </div>

            <h1
              style={{
                fontSize: "clamp(34px, 6vw, 64px)",
                lineHeight: 1.02,
                margin: "0 0 18px",
                letterSpacing: "-0.05em",
              }}
            >
              Il sistema di controllo operativo per MeToDo
            </h1>

            <p
              style={{
                fontSize: 18,
                lineHeight: 1.6,
                color: "#d0d0d0",
                maxWidth: 760,
                margin: 0,
              }}
            >
              Una piattaforma unica per gestire operations, performance, CRM e
              finanza con una logica orientata a risultati tangibili, crescita
              sostenibile e controllo operativo.
            </p>

            <div
              style={{
                display: "flex",
                gap: 12,
                flexWrap: "wrap",
                marginTop: 28,
              }}
            >
              <Link href="/operations" style={primaryButtonStyle}>
                Vai al task manager
              </Link>
              <a href="#moduli" style={secondaryButtonStyle}>
                Esplora i moduli
              </a>
            </div>
          </div>

          <div
            style={{
              background: "#121212",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 24,
              padding: 28,
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
            }}
          >
            <div>
              <div style={eyebrowStyle}>Framework MeToDo</div>
              <h2
                style={{
                  margin: "10px 0 18px",
                  fontSize: 24,
                  letterSpacing: "-0.03em",
                }}
              >
                Come lavoriamo
              </h2>
            </div>

            <div style={{ display: "grid", gap: 12 }}>
              {pillars.map((pillar, index) => (
                <div
                  key={pillar}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "14px 16px",
                    borderRadius: 16,
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{pillar}</span>
                  <span style={{ color: "#9e9e9e", fontSize: 13 }}>
                    0{index + 1}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="moduli" style={{ marginTop: 64 }}>
          <div style={eyebrowStyle}>Piattaforma</div>
          <h2
            style={{
              fontSize: 30,
              margin: "10px 0 12px",
              letterSpacing: "-0.04em",
            }}
          >
            Moduli principali
          </h2>
          <p
            style={{
              color: "#bdbdbd",
              maxWidth: 760,
              lineHeight: 1.7,
              marginBottom: 24,
            }}
          >
            MeToDo Control nasce per unire consulenza, controllo e operatività
            in un unico ambiente di lavoro.
          </p>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
              gap: 18,
            }}
          >
            {modules.map((module) => {
              const content = (
                <div
                  style={{
                    background: "#121212",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 20,
                    padding: 22,
                    minHeight: 180,
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "space-between",
                    transition: "transform 0.2s ease, border-color 0.2s ease",
                  }}
                >
                  <div>
                    <h3
                      style={{
                        margin: "0 0 10px",
                        fontSize: 20,
                        letterSpacing: "-0.03em",
                        color: "#ffffff",
                      }}
                    >
                      {module.title}
                    </h3>
                    <p
                      style={{
                        margin: 0,
                        color: "#bdbdbd",
                        lineHeight: 1.65,
                      }}
                    >
                      {module.description}
                    </p>
                  </div>

                  <div
                    style={{
                      marginTop: 18,
                      fontSize: 14,
                      color: "#ffffff",
                      opacity: module.href === "#" ? 0.45 : 1,
                    }}
                  >
                    {module.href === "#" ? "In roadmap" : "Apri modulo"}
                  </div>
                </div>
              );

              return module.href === "#" ? (
                <div key={module.title}>{content}</div>
              ) : (
                <Link
                  key={module.title}
                  href={module.href}
                  style={{ textDecoration: "none" }}
                >
                  {content}
                </Link>
              );
            })}
          </div>
        </section>

        <section
          id="metodo"
          style={{
            marginTop: 64,
            background: "#121212",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 24,
            padding: 28,
          }}
        >
          <div style={eyebrowStyle}>Posizionamento</div>
          <h2
            style={{
              margin: "10px 0 14px",
              fontSize: 28,
              letterSpacing: "-0.03em",
            }}
          >
            Consulting, management, intelligence, control
          </h2>
          <p
            style={{
              margin: 0,
              color: "#c9c9c9",
              lineHeight: 1.8,
              maxWidth: 900,
            }}
          >
            MeToDo si presenta come partner per business consulting,
            management, business intelligence e optimization nell’hospitality di
            alto profilo. Questa home traduce quello stesso linguaggio in una
            dashboard software, più sobria e orientata al controllo. :contentReference[oaicite:2]{index=2}
          </p>
        </section>
      </section>
    </main>
  );
}

const navLinkStyle: React.CSSProperties = {
  color: "#d6d6d6",
  textDecoration: "none",
  padding: "10px 14px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.03)",
};

const primaryButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "12px 18px",
  borderRadius: 999,
  background: "#ffffff",
  color: "#0b0b0b",
  textDecoration: "none",
  fontWeight: 600,
};

const secondaryButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "12px 18px",
  borderRadius: 999,
  background: "transparent",
  color: "#ffffff",
  textDecoration: "none",
  fontWeight: 600,
  border: "1px solid rgba(255,255,255,0.16)",
};

const eyebrowStyle: React.CSSProperties = {
  fontSize: 12,
  letterSpacing: "0.22em",
  textTransform: "uppercase",
  color: "#8f8f8f",
};