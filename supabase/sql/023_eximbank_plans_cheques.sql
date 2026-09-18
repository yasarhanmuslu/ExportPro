-- 023_eximbank_plans_cheques.sql
-- Ödeme Takibi — 2. katman: Eximbank takibi, ödeme planları (taksit), çek takibi
-- ve tahsilat hatırlatma günlüğü.
--
-- Supabase SQL Editor'de BİR KERE çalıştırın. İdempotent yazıldı.
-- ÖN KOŞUL: 022_payments_ledger.sql çalıştırılmış olmalı.
-- NOT: Numarası 023 ama 024/025'ten sonra yazıldı; birbirlerinden bağımsızdırlar,
--      çalıştırma sırası önemli değil.
--
-- ── EXIMBANK KURALLARI (İnci Hanım'ın tablosundan ölçüldü, 119 satırda şaşmıyor) ──
--   Vadesi Geçmiş Alacak Bildirimi (V.G.A.B) son tarihi = vade tarihi + 60 gün
--   Tazminat başvurusu son tarihi                        = V.G.A.B + 30 gün
--   İç uyarı eşiği (patron kararı)                       = vade tarihi + 45 gün
-- Bu tarihler HESAPLANIR, tabloda tutulmaz — vade değişirse kendiliğinden değişsin diye.
-- Tabloda tutulan: bildirimin fiilen YAPILDIĞI tarih ve referansı (eximbank_notices).

-- ============================================================
-- 1) customers — Eximbank bilgileri
-- ============================================================
alter table customers
    add column if not exists eximbank_insured        boolean not null default false,
    add column if not exists eximbank_customer_no    text,
    add column if not exists eximbank_limit          numeric(14,2),
    add column if not exists eximbank_limit_currency text,
    add column if not exists eximbank_term_days      integer;

comment on column customers.eximbank_insured is
    'Müşteri Eximbank kısa vadeli ihracat kredi sigortası kapsamında mı.';
comment on column customers.eximbank_limit is
    'Eximbank''ın bu alıcı için verdiği limit. Açık alacak toplamı bu limiti aşarsa fazlası sigorta kapsamı dışıdır.';

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'customers_eximbank_currency_chk') then
        alter table customers add constraint customers_eximbank_currency_chk
            check (eximbank_limit_currency is null or eximbank_limit_currency in ('EUR','USD','TRY','GBP'));
    end if;
end $$;

create index if not exists customers_eximbank_idx on customers (eximbank_insured) where eximbank_insured;

-- ── Eximbank anlaşmalı müşteriler ("Eximbank Müşteriler.xlsx", 16.09.2026) ──
update customers set eximbank_insured = true, eximbank_customer_no = '9097345',
       eximbank_limit = 35500,  eximbank_limit_currency = 'EUR', eximbank_term_days = 60
 where lower(company_name) like 'paffoni%';
update customers set eximbank_insured = true, eximbank_customer_no = '155884',
       eximbank_limit = 30000,  eximbank_limit_currency = 'EUR', eximbank_term_days = 60
 where lower(company_name) like 'herc%';
update customers set eximbank_insured = true, eximbank_customer_no = '9151810',
       eximbank_limit = 50000,  eximbank_limit_currency = 'EUR', eximbank_term_days = 60
 where lower(company_name) like 'arthema%';
update customers set eximbank_insured = true, eximbank_customer_no = '9166894',
       eximbank_limit = 50000,  eximbank_limit_currency = 'USD', eximbank_term_days = 90
 where lower(company_name) like 'abid%';
update customers set eximbank_insured = true, eximbank_customer_no = '9157361',
       eximbank_limit = 100000, eximbank_limit_currency = 'EUR', eximbank_term_days = 60
 where lower(company_name) like 'roper%';
update customers set eximbank_insured = true, eximbank_customer_no = '9054648',
       eximbank_limit = 60000,  eximbank_limit_currency = 'EUR', eximbank_term_days = 90
 where lower(company_name) like 'fiss%';

-- ============================================================
-- 2) orders — sipariş bazında kapsam istisnası
-- Boş (null) = müşteri kartındaki ayar geçerli. Limit dolduğu için kapsam dışı
-- kalan ya da anlaşma öncesi yapılmış sevkiyatlarda false yazılır.
-- ============================================================
alter table orders
    add column if not exists eximbank_covered boolean;

comment on column orders.eximbank_covered is
    'null: müşteri kartındaki eximbank_insured geçerli. true/false: bu sipariş için istisna.';

-- ============================================================
-- 3) eximbank_notices — Eximbank''a yapılan bildirimler
-- ============================================================
create table if not exists eximbank_notices (
    id            uuid primary key default gen_random_uuid(),
    user_id       uuid not null,
    order_id      uuid references orders(id) on delete cascade,
    receivable_id uuid references manual_receivables(id) on delete cascade,
    notice_type   text not null,
    notice_date   date not null,
    reference_no  text,
    amount        numeric(14,2),
    currency      text,
    outcome       text,
    notes         text,
    created_at    timestamptz not null default now(),

    constraint eximbank_notices_target_chk  check (num_nonnulls(order_id, receivable_id) = 1),
    constraint eximbank_notices_type_chk    check (notice_type in ('V.G.A.B', 'Tazminat Başvurusu')),
    constraint eximbank_notices_outcome_chk check (outcome is null or outcome in
        ('Beklemede', 'Tahsil Edildi', 'Tazminat Ödendi', 'Reddedildi', 'İptal')),
    constraint eximbank_notices_currency_chk check (currency is null or currency in ('EUR','USD','TRY','GBP'))
);

comment on table eximbank_notices is
    'Eximbank''a yapılan vadesi geçmiş alacak bildirimi (V.G.A.B) ve tazminat başvurusu kayıtları. Son tarihler vadeden hesaplanır, burada YAPILAN işlem tutulur.';

create index if not exists eximbank_notices_order_idx on eximbank_notices (order_id);
create index if not exists eximbank_notices_date_idx  on eximbank_notices (user_id, notice_date desc);

-- ============================================================
-- 4) payment_plans / payment_plan_installments — ödeme planı, taksitler
-- Plan bir SİPARİŞE ya da MANUEL ALACAĞA bağlanabilir (Sulav artık manuel alacak).
-- ============================================================
create table if not exists payment_plans (
    id            uuid primary key default gen_random_uuid(),
    user_id       uuid not null,
    customer_id   uuid references customers(id) on delete restrict,
    order_id      uuid references orders(id) on delete cascade,
    receivable_id uuid references manual_receivables(id) on delete cascade,
    title         text,
    currency      text not null default 'EUR',
    total_amount  numeric(14,2),
    agreed_date   date,
    status        text not null default 'Aktif',
    notes         text,
    created_at    timestamptz not null default now(),

    constraint payment_plans_target_chk   check (num_nonnulls(order_id, receivable_id) = 1),
    constraint payment_plans_currency_chk check (currency in ('EUR','USD','TRY','GBP')),
    constraint payment_plans_status_chk   check (status in ('Aktif','Tamamlandı','Bozuldu','İptal'))
);

create table if not exists payment_plan_installments (
    id          uuid primary key default gen_random_uuid(),
    plan_id     uuid not null references payment_plans(id) on delete cascade,
    seq         integer not null,
    due_date    date not null,
    amount      numeric(14,2) not null,
    notes       text,
    created_at  timestamptz not null default now(),
    unique (plan_id, seq)
);

comment on table payment_plans is
    'Müşteriyle anlaşılan taksit planı (ör. SULAV ÖDEME PLANI). Taksitin ödenip ödenmediği ayrı tutulmaz: gelen tahsilatlar plana bağlı belgeye dağıtıldıkça taksitler en eski vadeden başlayarak kapanmış sayılır.';

create index if not exists payment_plans_customer_idx  on payment_plans (customer_id);
create index if not exists payment_plan_inst_plan_idx  on payment_plan_installments (plan_id, due_date);

-- ============================================================
-- 5) cheques / cheque_allocations — çek takibi (Insteel modeli)
--
-- Insteel her sevkiyatta çek yazmıyor; birkaç sevkiyat birikince tek çek yazıyor
-- ve 60 günlük vade ÇEKİN tarihinden işliyor. Çek yazılana kadar siparişin vadesi
-- yoktur (025 ile mevcut sahte vadeler temizlendi).
--
-- Çek tahsil edildiğinde: payments tablosuna method='Çek' bir kayıt açılır,
-- cheque_id ile çeke bağlanır ve siparişlere dağıtılır.
-- ============================================================
create table if not exists cheques (
    id           uuid primary key default gen_random_uuid(),
    user_id      uuid not null,
    customer_id  uuid references customers(id) on delete restrict,
    cheque_no    text,
    bank_name    text,
    issue_date   date,
    due_date     date not null,
    amount       numeric(14,2) not null,
    currency     text not null default 'TRY',
    status       text not null default 'Portföyde',
    notes        text,
    created_at   timestamptz not null default now(),

    constraint cheques_currency_chk check (currency in ('EUR','USD','TRY','GBP')),
    constraint cheques_status_chk   check (status in
        ('Portföyde', 'Bankaya Verildi', 'Tahsil Edildi', 'Karşılıksız', 'İade Edildi'))
);

create table if not exists cheque_allocations (
    id            uuid primary key default gen_random_uuid(),
    cheque_id     uuid not null references cheques(id) on delete cascade,
    order_id      uuid references orders(id) on delete cascade,
    receivable_id uuid references manual_receivables(id) on delete cascade,
    amount        numeric(14,2) not null,
    created_at    timestamptz not null default now(),

    constraint cheque_allocations_target_chk check (num_nonnulls(order_id, receivable_id) = 1)
);

comment on table cheques is
    'Müşteriden alınan çek/senet. Vade çekin kendi vadesidir; kapsadığı siparişler cheque_allocations ile bağlanır. Tahsil edildiğinde payments''a method=Çek kaydı açılır.';
comment on table cheque_allocations is
    'Çekin hangi siparişleri/alacakları kapattığı. Insteel gibi "birkaç sevkiyata tek çek" akışı için.';

create index if not exists cheques_customer_idx  on cheques (customer_id);
create index if not exists cheques_due_idx       on cheques (user_id, due_date);
create index if not exists cheque_alloc_cheque_idx on cheque_allocations (cheque_id);
create index if not exists cheque_alloc_order_idx  on cheque_allocations (order_id);

-- Tahsilatı çeke bağlamak için
alter table payments
    add column if not exists cheque_id uuid;

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'fk_payments_cheque') then
        alter table payments add constraint fk_payments_cheque
            foreign key (cheque_id) references cheques(id) on delete set null;
    end if;
end $$;

-- ============================================================
-- 6) collection_reminders — tahsilat hatırlatma günlüğü
-- "Müşteriye ne zaman, kim, nasıl hatırlattı." Eximbank bildiriminde
-- "müşteriyi uyardık" kanıtı olarak da işe yarar.
-- ============================================================
create table if not exists collection_reminders (
    id            uuid primary key default gen_random_uuid(),
    user_id       uuid not null,
    customer_id   uuid references customers(id) on delete cascade,
    order_id      uuid references orders(id) on delete set null,
    receivable_id uuid references manual_receivables(id) on delete set null,
    reminder_date date not null default current_date,
    channel       text,
    summary       text,
    promised_date date,
    next_action_date date,
    created_by    uuid,
    created_at    timestamptz not null default now(),

    constraint collection_reminders_channel_chk check (channel is null or channel in
        ('E-posta', 'Telefon', 'WhatsApp', 'Yüz Yüze', 'Diğer'))
);

comment on column collection_reminders.promised_date is
    'Müşterinin "şu tarihte ödeyeceğim" dediği tarih. Bu tarih geçerse modül tekrar uyarır.';

create index if not exists collection_reminders_customer_idx on collection_reminders (customer_id, reminder_date desc);
create index if not exists collection_reminders_next_idx     on collection_reminders (user_id, next_action_date)
    where next_action_date is not null;

-- ============================================================
-- 7) SULAV ÖDEME PLANI (15.09.2026 tarihli anlaşma)
-- Sulav 2024-02, 025 ile manuel alacağa devredildi; plan oraya bağlanıyor.
-- Belgedeki toplam 45.689 USD, sistemdeki bakiye 45.688,50 USD — 0,50 USD fark
-- belgede yuvarlamadan geliyor, plan notunda kayıtlı.
-- ============================================================
do $$
declare
    v_rec   record;
    v_plan  uuid;
begin
    select mr.id, mr.user_id, mr.customer_id, mr.currency, mr.amount
      into v_rec
      from manual_receivables mr
     where mr.doc_no = '2024-02'
       and lower(coalesce(mr.customer_text, '')) like 'sulav%'
       and mr.description like 'Sipariş kaydından devredildi%'
     limit 1;

    if v_rec.id is null then
        raise notice 'Sulav manuel alacak kaydı bulunamadı (025 çalıştırıldı mı?) — plan atlandı.';
        return;
    end if;

    if exists (select 1 from payment_plans where receivable_id = v_rec.id) then
        raise notice 'Sulav planı zaten var — atlandı.';
        return;
    end if;

    insert into payment_plans (user_id, customer_id, receivable_id, title, currency,
                               total_amount, agreed_date, status, notes)
    values (v_rec.user_id, v_rec.customer_id, v_rec.id,
            'SULAV ÖDEME PLANI', 'USD', 45689, date '2026-09-15', 'Aktif',
            'Belge: SULAV ÖDEME PLANI (15.09.2026). Toplam sipariş 50.689 USD, ilk ödeme '
            || '16.08.2024 tarihinde 5.000 USD. Belgedeki kalan 45.689 USD, sistemdeki bakiye '
            || '45.688,50 USD — 0,50 USD fark belgedeki yuvarlamadan geliyor.')
    returning id into v_plan;

    insert into payment_plan_installments (plan_id, seq, due_date, amount) values
        (v_plan, 1, date '2026-10-10', 5689),
        (v_plan, 2, date '2026-11-10', 5000),
        (v_plan, 3, date '2026-12-10', 5000),
        (v_plan, 4, date '2027-01-10', 5000),
        (v_plan, 5, date '2027-02-10', 5000),
        (v_plan, 6, date '2027-03-10', 5000),
        (v_plan, 7, date '2027-04-10', 5000),
        (v_plan, 8, date '2027-05-10', 5000),
        (v_plan, 9, date '2027-06-10', 5000);

    raise notice 'Sulav ödeme planı kuruldu: 9 taksit, 45.689 USD';
end $$;

-- ============================================================
-- 8) RLS — 003_module_scoped_rls.sql kalıbı
-- ============================================================
alter table eximbank_notices          enable row level security;
alter table payment_plans             enable row level security;
alter table payment_plan_installments enable row level security;
alter table cheques                   enable row level security;
alter table cheque_allocations        enable row level security;
alter table collection_reminders      enable row level security;

-- user_id taşıyan tablolar
do $$
declare
    t text;
begin
    foreach t in array array['eximbank_notices', 'payment_plans', 'cheques', 'collection_reminders']
    loop
        execute format('drop policy if exists %1$s_select on %1$I', t);
        execute format($f$create policy %1$s_select on %1$I for select
            using (has_module_access(user_id, array['payments','orders'], 'view'))$f$, t);
        execute format('drop policy if exists %1$s_insert on %1$I', t);
        execute format($f$create policy %1$s_insert on %1$I for insert
            with check (has_module_access(user_id, array['payments'], 'edit'))$f$, t);
        execute format('drop policy if exists %1$s_update on %1$I', t);
        execute format($f$create policy %1$s_update on %1$I for update
            using (has_module_access(user_id, array['payments'], 'edit'))
            with check (has_module_access(user_id, array['payments'], 'edit'))$f$, t);
        execute format('drop policy if exists %1$s_delete on %1$I', t);
        execute format($f$create policy %1$s_delete on %1$I for delete
            using (has_module_access(user_id, array['payments'], 'edit'))$f$, t);
    end loop;
end $$;

-- taksitler: planın yetkisini miras alır
drop policy if exists payment_plan_installments_select on payment_plan_installments;
create policy payment_plan_installments_select on payment_plan_installments for select
    using (exists (select 1 from payment_plans p where p.id = plan_id
                     and has_module_access(p.user_id, array['payments','orders'], 'view')));
drop policy if exists payment_plan_installments_insert on payment_plan_installments;
create policy payment_plan_installments_insert on payment_plan_installments for insert
    with check (exists (select 1 from payment_plans p where p.id = plan_id
                     and has_module_access(p.user_id, array['payments'], 'edit')));
drop policy if exists payment_plan_installments_update on payment_plan_installments;
create policy payment_plan_installments_update on payment_plan_installments for update
    using (exists (select 1 from payment_plans p where p.id = plan_id
                     and has_module_access(p.user_id, array['payments'], 'edit')))
    with check (exists (select 1 from payment_plans p where p.id = plan_id
                     and has_module_access(p.user_id, array['payments'], 'edit')));
drop policy if exists payment_plan_installments_delete on payment_plan_installments;
create policy payment_plan_installments_delete on payment_plan_installments for delete
    using (exists (select 1 from payment_plans p where p.id = plan_id
                     and has_module_access(p.user_id, array['payments'], 'edit')));

-- çek dağıtımları: çekin yetkisini miras alır
drop policy if exists cheque_allocations_select on cheque_allocations;
create policy cheque_allocations_select on cheque_allocations for select
    using (exists (select 1 from cheques c where c.id = cheque_id
                     and has_module_access(c.user_id, array['payments','orders'], 'view')));
drop policy if exists cheque_allocations_insert on cheque_allocations;
create policy cheque_allocations_insert on cheque_allocations for insert
    with check (exists (select 1 from cheques c where c.id = cheque_id
                     and has_module_access(c.user_id, array['payments'], 'edit')));
drop policy if exists cheque_allocations_update on cheque_allocations;
create policy cheque_allocations_update on cheque_allocations for update
    using (exists (select 1 from cheques c where c.id = cheque_id
                     and has_module_access(c.user_id, array['payments'], 'edit')))
    with check (exists (select 1 from cheques c where c.id = cheque_id
                     and has_module_access(c.user_id, array['payments'], 'edit')));
drop policy if exists cheque_allocations_delete on cheque_allocations;
create policy cheque_allocations_delete on cheque_allocations for delete
    using (exists (select 1 from cheques c where c.id = cheque_id
                     and has_module_access(c.user_id, array['payments'], 'edit')));

-- ============================================================
-- 9) KONTROL
-- ============================================================
-- 9a) Eximbank müşterileri (6 satır dönmeli)
-- select company_name, eximbank_customer_no, eximbank_limit, eximbank_limit_currency, eximbank_term_days
--   from customers where eximbank_insured order by company_name;

-- 9b) Eximbank kapsamındaki açık alacaklar ve kritik tarihler
-- select c.company_name, o.order_number, o.currency, o.remaining_balance, o.due_date,
--        o.due_date + 45 as ic_uyari, o.due_date + 60 as vgab_son_tarih,
--        o.due_date + 90 as tazminat_son_tarih,
--        (o.due_date + 45) - current_date as ic_uyariya_kalan_gun
--   from orders o join customers c on c.id = o.customer_id
--  where coalesce(o.eximbank_covered, c.eximbank_insured)
--    and coalesce(o.remaining_balance, 0) > 0.005
--    and o.due_date is not null
--  order by o.due_date;

-- 9c) Eximbank limit kullanımı (açık alacak / limit)
-- select c.company_name, c.eximbank_limit, c.eximbank_limit_currency,
--        sum(o.remaining_balance) filter (where o.currency = c.eximbank_limit_currency) as acik_alacak
--   from customers c join orders o on o.customer_id = c.id
--  where c.eximbank_insured and coalesce(o.remaining_balance, 0) > 0.005
--  group by c.company_name, c.eximbank_limit, c.eximbank_limit_currency;

-- 9d) Sulav planı (9 taksit dönmeli)
-- select i.seq, i.due_date, i.amount from payment_plan_installments i
--   join payment_plans p on p.id = i.plan_id where p.title = 'SULAV ÖDEME PLANI' order by i.seq;
