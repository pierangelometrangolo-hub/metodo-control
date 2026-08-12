// Genera lo script SQL di import per il modulo CRM a partire da
// data/Struttura_CRM_METODO.xlsx - NON scrive nulla su Supabase, produce
// solo un file .sql dentro data/generated/ da rivedere ed eseguire a mano
// nell'SQL Editor (stesso flusso gia' usato per Performance).
//
// Regola di sicurezza: nessun dato reale (P.IVA, email, telefoni,
// referenti) viene stampato a console per default - solo conteggi. Con
// --verbose vengono stampati anche i dettagli delle righe scartate/
// ambigue per il debug, mai attivo di default.
//
// Uso: node scripts/crm-import.js [--verbose]

const path = require("path");
const fs = require("fs");
const XLSX = require("xlsx");

const VERBOSE = process.argv.includes("--verbose");

const EXCEL_PATH = path.join(__dirname, "..", "data", "Struttura_CRM_METODO.xlsx");
const OUTPUT_DIR = path.join(__dirname, "..", "data", "generated");

// Mapping esplicito nome struttura (colonna Excel) -> nome reale in
// structures.name. Un solo caso non corrisponde 1:1 (Palazzo DeBelli /
// Dimora De Belli) - nessuna logica di fuzzy matching generale, solo
// questa singola riga mappata per nome.
const STRUCTURE_NAME_MAP = {
  "Palazzo Arco Cadura": "Palazzo Arco Cadura",
  "Palazzo Rollo": "Palazzo Rollo",
  "Villa Neviera": "Villa Neviera",
  "Montecallini": "Montecallini",
  "Sangiorgio Resort": "Sangiorgio Resort",
  "Palazzo DeBelli": "Dimora De Belli",
};

function isEmpty(v) {
  return v === null || v === undefined || String(v).trim() === "";
}

function s(v) {
  // stringa SQL, o null letterale se vuota
  if (isEmpty(v)) return "null";
  return "'" + String(v).trim().replace(/'/g, "''") + "'";
}

function sOrDefault(v, fallback) {
  return isEmpty(v) ? s(fallback) : s(v);
}

function toSqlDate(v) {
  if (isEmpty(v)) return "null";
  let d;
  if (v instanceof Date) {
    d = v;
  } else {
    // fallback per celle non formattate come data ma con un valore analogo
    const parsed = new Date(v);
    if (isNaN(parsed.getTime())) return "null";
    d = parsed;
  }
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `'${y}-${m}-${day}'`;
}

function parseNoticeMonths(v) {
  if (isEmpty(v)) return "null";
  const match = String(v).match(/(\d+)/);
  return match ? match[1] : "null";
}

// Cerca prima in "Nome Struttura", poi in "Ragione Sociale Hotel" come
// fallback se la prima e' vuota - bug scoperto sulla riga Palazzo DeBelli:
// "Nome Struttura" e' vuota per quella riga, il nome esiste solo in
// "Ragione Sociale Hotel", quindi il lookup su una sola colonna tornava
// null senza nemmeno tentare il match, non perche' la mappa non avesse la
// voce. Stesso pattern di fallimento silenzioso segnalato per altri campi
// - qui corretto in modo generale, non solo per questa riga.
function structureIdSubquery(nomeStruttura, ragioneSociale) {
  const candidate = !isEmpty(nomeStruttura) ? nomeStruttura : ragioneSociale;
  if (isEmpty(candidate)) return "null";
  const mapped = STRUCTURE_NAME_MAP[String(candidate).trim()];
  if (!mapped) return { unmapped: candidate };
  return `(select id from structures where name = ${s(mapped)})`;
}

function contractStatusEnum(v) {
  if (isEmpty(v)) return "null";
  const norm = String(v).trim().toLowerCase();
  if (norm.includes("non def")) return "'non_definito'";
  if (norm.includes("attivo")) return "'attivo'";
  if (norm.includes("scadut")) return "'scaduto'";
  if (norm.includes("disdett")) return "'disdetto'";
  return { ambiguous: v };
}

function rowValues(sheet, rowIndex, colCount) {
  const vals = [];
  for (let c = 0; c < colCount; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c })];
    vals.push(cell ? cell.v : null);
  }
  return vals;
}

function hyperlinkTarget(sheet, rowIndex, colIndex) {
  const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: colIndex })];
  return cell && cell.l && cell.l.Target ? cell.l.Target : null;
}

function main() {
  if (!fs.existsSync(EXCEL_PATH)) {
    console.error("File non trovato:", EXCEL_PATH);
    process.exit(1);
  }

  const wb = XLSX.readFile(EXCEL_PATH, { cellDates: true });
  const discarded = [];
  const skippedManual = [];
  const sqlBlocks = [];

  let clientsAccounts = 0;
  let contactsAccounts = 0;

  // ============ ACCOUNTS_CONSULENZE ============
  const accSheet = wb.Sheets["ACCOUNTS_CONSULENZE"];
  if (!accSheet) {
    console.error("Foglio ACCOUNTS_CONSULENZE non trovato.");
    process.exit(1);
  }
  const accRange = XLSX.utils.decode_range(accSheet["!ref"]);

  for (let r = 2; r <= accRange.e.r; r++) {
    const [
      ragioneSociale, piva, nomeStruttura, dataInizio, dataFine,
      statoContratto, mesiPreavviso, owner, telefono, email,
    ] = rowValues(accSheet, r, 10);

    const hasAny = [ragioneSociale, piva, nomeStruttura].some((v) => !isEmpty(v));
    if (!hasAny) continue; // riga vuota, fine dati reali

    if (isEmpty(ragioneSociale)) {
      discarded.push({ sheet: "ACCOUNTS_CONSULENZE", row: r + 1, reason: "business_name (Ragione Sociale Hotel) mancante - colonna NOT NULL" });
      continue;
    }

    // Palazzo DeBelli: inserita manualmente da Pierangelo direttamente su
    // Supabase (structure_id -> Dimora De Belli, contract_status ->
    // 'non_definito', giudizio di business su un campo che nel file resta
    // vuoto) - esclusa qui apposta per non generare un duplicato se questo
    // script viene rieseguito.
    if (String(ragioneSociale).trim() === "Palazzo DeBelli") {
      skippedManual.push({ sheet: "ACCOUNTS_CONSULENZE", row: r + 1, reason: "Palazzo DeBelli - gia' inserita manualmente su Supabase, esclusa di proposito" });
      continue;
    }

    const structureResult = structureIdSubquery(nomeStruttura, ragioneSociale);
    if (structureResult && structureResult.unmapped) {
      discarded.push({ sheet: "ACCOUNTS_CONSULENZE", row: r + 1, reason: `nome struttura non nella mappa esplicita: "${structureResult.unmapped}"` });
      continue;
    }

    const contractStatusResult = contractStatusEnum(statoContratto);
    if (contractStatusResult && contractStatusResult.ambiguous) {
      discarded.push({ sheet: "ACCOUNTS_CONSULENZE", row: r + 1, reason: `Stato Contratto ambiguo, non riconosciuto: "${contractStatusResult.ambiguous}"` });
      continue;
    }

    const docUrl = hyperlinkTarget(accSheet, r, 10);

    const clientCols = [
      "business_name", "vat_number", "client_type", "status",
      "contract_start_date", "contract_end_date", "contract_status",
      "contract_notice_months", "contract_document_url", "structure_id",
    ];
    const clientVals = [
      s(ragioneSociale),
      s(piva),
      "'consulenza'",
      "'attivo'",
      toSqlDate(dataInizio),
      toSqlDate(dataFine),
      contractStatusResult,
      parseNoticeMonths(mesiPreavviso),
      s(docUrl),
      structureResult,
    ];

    const hasContact = !isEmpty(owner) || !isEmpty(telefono) || !isEmpty(email);
    const contactName = sOrDefault(owner, "ND");

    let block = `with inserted_client as (\n`;
    block += `  insert into crm_clients (${clientCols.join(", ")})\n`;
    block += `  values (${clientVals.join(", ")})\n`;
    block += `  returning id\n`;
    block += `)\n`;

    if (hasContact) {
      block += `insert into crm_contacts (client_id, name, role, phone, email)\n`;
      block += `select id, ${contactName}, 'ND', ${s(telefono)}, ${s(email)} from inserted_client;\n`;
      contactsAccounts += 1;
    } else {
      block += `select id from inserted_client;\n`;
    }

    sqlBlocks.push(`-- ACCOUNTS_CONSULENZE riga Excel ${r + 1}\n${block}`);
    clientsAccounts += 1;
  }

  // ============ PROSPECT_LEADS ============
  const prospSheet = wb.Sheets["PROSPECT_LEADS"];
  if (!prospSheet) {
    console.error("Foglio PROSPECT_LEADS non trovato.");
    process.exit(1);
  }
  const prospRange = XLSX.utils.decode_range(prospSheet["!ref"]);

  const groups = new Map(); // chiave dedup -> [righe]
  let prospectDataRows = 0;

  for (let r = 1; r <= prospRange.e.r; r++) {
    const allCols = rowValues(prospSheet, r, 20);
    const [
      nome, cognome, ruolo, nomeStrutturaHotel, piva, ragioneSociale,
      indirizzo, citta, cap, sdiPec, email, telefono, sitoWeb,
      _numCamere, sorgente, _statusLead, _rating, dataAcquisizione,
      _interesse, _note,
    ] = allCols;

    const hasAnyDataAtAll = allCols.some((v) => !isEmpty(v));
    if (!hasAnyDataAtAll) continue; // riga davvero vuota, fine dati reali

    const hasIdentifyingData = [nome, cognome, ragioneSociale, nomeStrutturaHotel, piva].some((v) => !isEmpty(v));
    if (!hasIdentifyingData) {
      discarded.push({ sheet: "PROSPECT_LEADS", row: r + 1, reason: "nessun campo identificativo compilato (Nome/Cognome/Ragione Sociale/Nome Struttura/P.IVA tutti vuoti) - solo colonne fuori scope (es. Note, Status Lead) valorizzate" });
      continue;
    }

    prospectDataRows += 1;

    const key = isEmpty(piva) ? `__EMPTY_${r}` : String(piva).trim().toLowerCase();
    const list = groups.get(key) || [];
    list.push({
      row: r + 1, nome, cognome, ruolo, nomeStrutturaHotel, piva, ragioneSociale,
      indirizzo, citta, cap, sdiPec, email, telefono, sitoWeb, sorgente, dataAcquisizione,
    });
    groups.set(key, list);
  }

  let clientsProspect = 0;
  let contactsProspect = 0;

  for (const [key, rows] of groups) {
    const primary = rows[0];

    const businessName = !isEmpty(primary.ragioneSociale) ? primary.ragioneSociale : primary.nomeStrutturaHotel;
    if (isEmpty(businessName)) {
      discarded.push({ sheet: "PROSPECT_LEADS", row: rows.map((x) => x.row).join(","), reason: "sia Ragione Sociale sia Nome Struttura/Hotel mancanti - impossibile determinare business_name" });
      continue;
    }

    const address = !isEmpty(primary.citta)
      ? [primary.indirizzo, primary.citta].filter((v) => !isEmpty(v)).join(", ")
      : primary.indirizzo;

    const clientCols = [
      "business_name", "vat_number", "address", "postal_code", "sdi_code",
      "email", "phone", "website", "client_type", "status",
      "source_event", "acquired_at",
    ];
    const clientVals = [
      s(businessName),
      sOrDefault(primary.piva, "ND"),
      s(address),
      sOrDefault(primary.cap, "ND"),
      s(primary.sdiPec),
      s(primary.email),
      s(primary.telefono),
      s(primary.sitoWeb),
      "'formazione'",
      "'prospect'",
      s(primary.sorgente),
      toSqlDate(primary.dataAcquisizione),
    ];

    let block = `with inserted_client as (\n`;
    block += `  insert into crm_clients (${clientCols.join(", ")})\n`;
    block += `  values (${clientVals.join(", ")})\n`;
    block += `  returning id\n`;
    block += `)\n`;
    block += `insert into crm_contacts (client_id, name, role, phone, email)\n`;

    const selects = rows.map((row) => {
      const fullName = [row.nome, row.cognome].filter((v) => !isEmpty(v)).join(" ");
      const name = isEmpty(fullName) ? "'ND'" : s(fullName);
      const role = sOrDefault(row.ruolo, "ND");
      contactsProspect += 1;
      return `  select id, ${name}, ${role}, ${s(row.telefono)}, ${s(row.email)} from inserted_client`;
    });
    block += selects.join("\n  union all\n") + ";\n";

    const rowNumbers = rows.map((x) => x.row).join(",");
    sqlBlocks.push(`-- PROSPECT_LEADS righe Excel ${rowNumbers} (dedup su ${isEmpty(primary.piva) ? "nessuna P.IVA/CF, riga singola" : "P.IVA/CF"})\n${block}`);
    clientsProspect += 1;
  }

  // ============ OUTPUT ============
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outPath = path.join(OUTPUT_DIR, "crm_import.sql");

  const header = `-- Import CRM generato da scripts/crm-import.js
-- Sorgente: data/Struttura_CRM_METODO.xlsx (ACCOUNTS_CONSULENZE + PROSPECT_LEADS)
-- STORICO_EVENTI deliberatamente escluso (fuori scope V0).
-- Da rivedere ed eseguire manualmente in Supabase SQL Editor - non eseguito
-- automaticamente da questo script.
-- Generato: ${new Date().toISOString()}
-- Contiene dati reali di clienti (P.IVA, email, telefoni, referenti) - non
-- committare, non condividere fuori da questo repository locale.

`;

  fs.writeFileSync(outPath, header + sqlBlocks.join("\n"), "utf8");

  // ============ LOG SOLO NUMERICO (default) ============
  console.log(`ACCOUNTS_CONSULENZE: ${clientsAccounts} clienti, ${contactsAccounts} contatti`);
  console.log(`PROSPECT_LEADS: ${prospectDataRows} righe dati, ${clientsProspect} clienti unici dopo dedup, ${contactsProspect} contatti`);
  console.log(`Righe scartate/ambigue: ${discarded.length}`);
  console.log(`Righe escluse perche' gia' inserite manualmente: ${skippedManual.length}`);
  console.log(`File generato: ${path.relative(path.join(__dirname, ".."), outPath)}`);

  if (skippedManual.length > 0) {
    console.log("\nEscluse (gia' su Supabase, non rigenerate qui):");
    skippedManual.forEach((d) => console.log(`  - ${d.sheet} riga ${d.row}: ${d.reason}`));
  }

  if (discarded.length > 0) {
    console.log("\nMotivi scarto (nessun dato reale, solo etichette foglio/riga/motivo):");
    discarded.forEach((d) => {
      console.log(`  - ${d.sheet} riga ${d.row}: ${d.reason.replace(/"[^"]*"/, VERBOSE ? "$&" : '"[valore nascosto, rilanciare con --verbose]"')}`);
    });
  }
}

main();
