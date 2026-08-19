import AdmZip from "adm-zip";
import type { RawSourceFile, SourceFileType } from "./types";

// Estrae i file fiscali/ricevute da uno ZIP batch (es. l'export annuale di
// GAP GROUP S.R.L.). Source-agnostic sul contenuto: non assume nulla sul
// numero di file, li classifica solo per estensione.
export function extractFilesFromZip(zipBuffer: Buffer): RawSourceFile[] {
  const zip = new AdmZip(zipBuffer);
  const entries = zip.getEntries().filter((e) => !e.isDirectory);

  return entries.map((entry) => {
    const name = entry.entryName;
    const fileType = classifyFileType(name);
    return {
      fileName: name,
      content: entry.getData(),
      fileType,
    };
  });
}

// Euristica best-effort basata sui pattern di naming SdI piu' comuni (le
// ricevute/notifiche hanno marcatori tipo _RC_/_NS_/_MC_/_MT_/_EC_/_AT_ nel
// nome file, il documento fiscale no). Va verificata e corretta sui nomi
// file reali del batch appena disponibile - qui e' solo un punto di
// partenza ragionevole, non una regola definitiva.
const RECEIPT_MARKERS = ["_rc_", "_ns_", "_mc_", "_mt_", "_ec_", "_at_", "_sc_"];

function classifyFileType(fileName: string): SourceFileType {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xml.p7m") || lower.endsWith(".p7m")) return "xml_p7m";
  if (lower.endsWith(".xml")) {
    return RECEIPT_MARKERS.some((marker) => lower.includes(marker)) ? "receipt" : "xml";
  }
  return "receipt";
}
