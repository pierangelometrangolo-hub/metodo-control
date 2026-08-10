-- ============ FIX: RLS abilitata senza policy su performance_monthly_snapshot ============
-- Stesso schema di problema gia' diagnosticato piu' volte in questo modulo
-- (structures, bd_imports, performance_daily_snapshot, channel_revenue,
-- guest_nationality): RLS abilitata ma zero policy, quindi ogni SELECT lato
-- client autenticato torna 0 righe silenziosamente.
--
-- Scoperto verificando fn_month_snapshot_asof (migration 20260811090000) con
-- un utente autenticato reale: con la service role la funzione trovava le
-- righe attese per Palazzo Rollo/Arco Cadura/Villa Neviera (agosto 2025),
-- ma con un utente reale tornava 0 righe pur non avendo cambiato la query -
-- segno che il blocco era a livello di RLS sulla tabella, non nella
-- funzione ne' nella query della Dashboard.
--
-- Solo SELECT: nessuna scrittura da app su questa tabella (popolata via
-- import esterno dei report ADR-RevPAR settimanali), coerente con l'uso in
-- sola lettura da fn_month_snapshot_asof.

create policy performance_monthly_snapshot_select_authenticated
on performance_monthly_snapshot
for select
to authenticated
using (true);
