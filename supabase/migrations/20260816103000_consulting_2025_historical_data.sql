-- ============ PROPOSTA — NON ESEGUIRE — Consulenze storiche 2025 + Giorgia ============
-- Dipende da 20260816100000 (counterparties) e 20260816102000
-- (consulting_fee_rules.counterparty_id).
--
-- DECISIONE: per i 7 clienti storici creo SOLO counterparty (ruolo
-- customer), NON un crm_clients corrispondente - crm_clients porta con se'
-- campi CRM-specifici (commissioni, contract_status, is_formazione/eventi/
-- fornitore) che non servono a Finance e che avrebbero richiesto di
-- introdurre un nuovo valore in un vocabolario CRM esistente
-- (contract_status) senza approvazione. counterparties.status ('active'/
-- 'inactive') e' un vocabolario NUOVO, definito qui per la prima volta,
-- quindi non c'e' nessun retaggio da rispettare o rompere. Se in futuro
-- CRM vorra' un proprio record storico parallelo per questi 7 nomi, resta
-- una decisione CRM separata - non la prendo qui.
--
-- Nessuna P.IVA/ragione sociale inventata: legal_name/vat_number/
-- fiscal_code restano NULL, display_name e' il nome commerciale che mi hai
-- dato.

insert into public.counterparties (display_name, status, notes)
values
  ('Borgo Bevagna', 'inactive', 'Consulenza storica 2025, chiusa. Nome commerciale - ragione sociale/P.IVA non note, non inventate.'),
  ('Kelina', 'inactive', 'Consulenza storica 2025, chiusa. Nome commerciale - ragione sociale/P.IVA non note, non inventate.'),
  ('La Roccia', 'inactive', 'Consulenza storica 2025, chiusa. Nome commerciale - ragione sociale/P.IVA non note, non inventate.'),
  ('Sarmenti', 'inactive', 'Consulenza storica 2025, chiusa. Nome commerciale - ragione sociale/P.IVA non note, non inventate.'),
  ('Sea Garden', 'inactive', 'Consulenza storica 2025, chiusa. Fee GAP 15% confermato. Nome commerciale - ragione sociale/P.IVA non note, non inventate.'),
  ('Volito', 'inactive', 'Consulenza storica 2025, chiusa. Fee GAP 10% confermato. Nome commerciale - ragione sociale/P.IVA non note, non inventate.'),
  ('La Villa', 'inactive', 'Progetto startup, 3 mesi, concluso 2025. Fee GAP totale 3.000 EUR una tantum. Date esatte non note - nessuna evidenza in DB, probabilmente ricostruibili dal batch fatture 2025.');

insert into public.counterparty_roles (counterparty_id, role)
select id, 'customer' from public.counterparties
where display_name in ('Borgo Bevagna','Kelina','La Roccia','Sarmenti','Sea Garden','Volito','La Villa');

-- ---------- Giorgia ----------
-- Fornitrice GAP con P.IVA propria (confermato) - rappresentata come
-- counterparty con identita' economico-fiscale propria, profile_id come
-- collegamento secondario al suo utente reale in MC, non come identita'
-- primaria. vat_number NON inventata: la aggiungerai tu quando disponibile.
insert into public.counterparties (display_name, profile_id, status, notes)
select 'Giorgia', p.id, 'active', 'Fornitrice GAP. P.IVA reale non ancora inserita - da aggiungere quando disponibile, non inventata qui.'
from public.profiles p
where p.nome = 'Giorgia';

insert into public.counterparty_roles (counterparty_id, role)
select cp.id, r.role
from public.counterparties cp
cross join (values ('supplier'), ('consultant')) as r(role)
where cp.display_name = 'Giorgia' and cp.profile_id is not null;

-- ---------- Fee rules 2025 confermate (6 su 7 - La Villa esclusa) ----------
insert into public.consulting_fee_rules (counterparty_id, valid_from, valid_to, fee_model, fee_pct, calculation_basis, consultant_pct, is_active, notes)
select id, '2025-01-01'::date, '2025-12-31'::date, 'percentage', 10, 'revenue', 20, true, 'Borgo Bevagna 2025: fee GAP 10% revenue. Quota GM 20%. Consulenza storica.'
from public.counterparties where display_name = 'Borgo Bevagna'
union all
select id, '2025-01-01'::date, '2025-12-31'::date, 'percentage', 7, 'revenue', 20, true, 'Kelina 2025: fee GAP 7% revenue. Quota GM 20%. Consulenza storica.'
from public.counterparties where display_name = 'Kelina'
union all
select id, '2025-01-01'::date, '2025-12-31'::date, 'percentage', 10, 'revenue', 15, true, 'La Roccia 2025: fee GAP 10% revenue. Quota GM 15%. Consulenza storica.'
from public.counterparties where display_name = 'La Roccia'
union all
select id, '2025-01-01'::date, '2025-12-31'::date, 'percentage', 10, 'revenue', 20, true, 'Sarmenti 2025: fee GAP 10% revenue. Quota GM 20%. Consulenza storica.'
from public.counterparties where display_name = 'Sarmenti'
union all
select id, '2025-01-01'::date, '2025-12-31'::date, 'percentage', 15, 'revenue', 20, true, 'Sea Garden 2025: fee GAP 15% revenue (confermato, non 10%). Quota GM 20%. Consulenza storica.'
from public.counterparties where display_name = 'Sea Garden'
union all
select id, '2025-01-01'::date, '2025-12-31'::date, 'percentage', 10, 'revenue', 15, true, 'Volito 2025: fee GAP 10% revenue (confermato - anomalia Excel al 7% non promossa a regola). Quota GM 15%.'
from public.counterparties where display_name = 'Volito';

-- Diagnostica: 6 righe.
select cp.display_name, r.fee_pct, r.consultant_pct
from public.consulting_fee_rules r
join public.counterparties cp on cp.id = r.counterparty_id
where cp.display_name in ('Borgo Bevagna','Kelina','La Roccia','Sarmenti','Sea Garden','Volito')
order by cp.display_name;

-- ============ LA VILLA 2025 — fee rule NON INCLUSA: contract_dates_missing ============
-- Counterparty gia' creata sopra. consulting_fee_rules.valid_from resta
-- NOT NULL - nessuna data inventata. fee_model='fixed', fixed_amount=3000,
-- consultant_pct=20 pronti non appena le date reali emergeranno (probabile
-- fonte: batch fatture 2025, come da tua indicazione).

-- ============ MONTECALLINI 2025 — NON INCLUSA: fee_rule_incomplete ============
-- consultant_pct 15% confermato ma fixed_amount/overcommission_pct/
-- overcommission_threshold 2025 non recuperabili da nessuna fonte
-- verificata. Nessuna riga inserita finche' non arriva evidenza
-- contrattuale - "nessuna riga consulting_fee_rules per Montecallini 2025"
-- e' gia' lo stato leggibile dal calculation engine.
