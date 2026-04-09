export default function Home() {
  return (
    <main style={{ padding: "40px", fontFamily: "Arial" }}>
      <h1>MeToDo Control</h1>
      <p>Il sistema di controllo operativo per l’hospitality</p>

      <hr style={{ margin: "30px 0" }} />

      <h2>Dashboard</h2>

      <div style={{ display: "flex", gap: "20px", marginTop: "20px", flexWrap: "wrap" }}>
        <a href="/operations" style={{ textDecoration: "none", color: "black" }}>
          <div style={{ padding: "20px", border: "1px solid #ccc", borderRadius: "8px", minWidth: "220px" }}>
            <h3>Operations</h3>
            <p>Gestione task e attività</p>
          </div>
        </a>

        <div style={{ padding: "20px", border: "1px solid #ccc", borderRadius: "8px", minWidth: "220px" }}>
          <h3>Performance</h3>
          <p>KPI e controllo risultati</p>
        </div>

        <div style={{ padding: "20px", border: "1px solid #ccc", borderRadius: "8px", minWidth: "220px" }}>
          <h3>CRM</h3>
          <p>Clienti e relazioni</p>
        </div>

        <div style={{ padding: "20px", border: "1px solid #ccc", borderRadius: "8px", minWidth: "220px" }}>
          <h3>Finance</h3>
          <p>Controllo economico</p>
        </div>
      </div>

      <p style={{ marginTop: "40px" }}>Versione 1</p>
    </main>
  );
}