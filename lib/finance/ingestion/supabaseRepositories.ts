import type { SupabaseClient } from "@supabase/supabase-js";
import type { CounterpartyRecord, CounterpartyRepository } from "./counterpartyResolver";
import type { EngagementRecord, EngagementRepository } from "./engagementResolver";

// Implementazioni reali (Supabase) delle interfacce di data access usate
// dal dry-run engine. Mai chiamate dai test unitari (quelli usano
// repository in-memory) - solo dal punto di ingresso che eseguira' il
// dry-run reale sul batch, quando il file ZIP sara' disponibile.

function toCounterpartyRecord(row: {
  id: string;
  display_name: string;
  legal_name: string | null;
  vat_number: string | null;
  fiscal_code: string | null;
  crm_client_id: string | null;
}): CounterpartyRecord {
  return {
    id: row.id,
    displayName: row.display_name,
    legalName: row.legal_name,
    vatNumber: row.vat_number,
    fiscalCode: row.fiscal_code,
    crmClientId: row.crm_client_id,
  };
}

export class SupabaseCounterpartyRepository implements CounterpartyRepository {
  constructor(private readonly client: SupabaseClient) {}

  async findByVatNumber(vat: string): Promise<CounterpartyRecord[]> {
    const { data, error } = await this.client
      .from("counterparties")
      .select("id, display_name, legal_name, vat_number, fiscal_code, crm_client_id")
      .eq("vat_number", vat);
    if (error) throw error;
    return (data ?? []).map(toCounterpartyRecord);
  }

  async findByFiscalCode(cf: string): Promise<CounterpartyRecord[]> {
    const { data, error } = await this.client
      .from("counterparties")
      .select("id, display_name, legal_name, vat_number, fiscal_code, crm_client_id")
      .eq("fiscal_code", cf);
    if (error) throw error;
    return (data ?? []).map(toCounterpartyRecord);
  }

  async findByCrmClientVatNumber(vat: string): Promise<CounterpartyRecord[]> {
    const { data: crmRows, error: crmError } = await this.client
      .from("crm_clients")
      .select("id")
      .eq("vat_number", vat);
    if (crmError) throw crmError;
    const crmIds = (crmRows ?? []).map((r) => r.id);
    if (crmIds.length === 0) return [];

    const { data, error } = await this.client
      .from("counterparties")
      .select("id, display_name, legal_name, vat_number, fiscal_code, crm_client_id")
      .in("crm_client_id", crmIds);
    if (error) throw error;
    return (data ?? []).map(toCounterpartyRecord);
  }

  async findAll(): Promise<CounterpartyRecord[]> {
    const { data, error } = await this.client
      .from("counterparties")
      .select("id, display_name, legal_name, vat_number, fiscal_code, crm_client_id");
    if (error) throw error;
    return (data ?? []).map(toCounterpartyRecord);
  }
}

export class SupabaseEngagementRepository implements EngagementRepository {
  constructor(private readonly client: SupabaseClient) {}

  async findByCounterpartyId(counterpartyId: string): Promise<EngagementRecord[]> {
    const { data, error } = await this.client
      .from("consulting_engagements")
      .select("id, display_name, status")
      .eq("counterparty_id", counterpartyId);
    if (error) throw error;
    return (data ?? []).map((r) => ({ id: r.id, displayName: r.display_name, status: r.status as "active" | "closed" }));
  }
}

// Verifica se finance_business_units contiene gia' righe - usata per
// popolare DryRunReport.classification.businessUnitsSeeded senza mai
// crearle da qui.
export async function checkBusinessUnitsSeeded(client: SupabaseClient): Promise<boolean> {
  const { count, error } = await client.from("finance_business_units").select("*", { count: "exact", head: true });
  if (error) throw error;
  return (count ?? 0) > 0;
}

export async function fetchExpectedIssuer(client: SupabaseClient): Promise<{ legalName: string; vatNumber: string }> {
  const { data, error } = await client
    .from("legal_entities")
    .select("name, vat_number")
    .eq("is_default", true)
    .single();
  if (error) throw error;
  if (!data.vat_number) throw new Error("legal_entities.is_default non ha una vat_number valorizzata - impossibile verificare l'emittente atteso.");
  return { legalName: data.name, vatNumber: data.vat_number };
}
