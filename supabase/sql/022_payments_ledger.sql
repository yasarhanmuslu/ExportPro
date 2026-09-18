-- 022_payments_ledger.sql
-- Ödeme Takibi modülünün çekirdeği: TARİHLİ TAHSİLAT DEFTERİ.
-- Bu dosyayı Supabase SQL Editor'de BİR KERE çalıştırın. İdempotent yazıldı:
-- tekrar çalıştırmak hata vermez ve açılış bakiyelerini ikinci kez eklemez.
--
-- ── NEDEN ─────────────────────────────────────────────────────────────────────
-- Bugüne kadar bir siparişin tahsilatı tek bir sayıydı: orders.advance_payment.
-- Her yeni ödeme bu sayının üstüne ekleniyordu, dolayısıyla:
--   • Ödemenin TARİHİ hiçbir yerde yok (2ag 2026-02: 04.09 ve 15.09'da iki eşit
--     taksit geldi, sistemde sadece 35.504 USD toplamı görünüyor).
--   • Tek SWIFT ile birden çok siparişin kapatılması ifade edilemiyor.
--   • Fazla ödemenin sonraki siparişe mahsubu kayıtlanamıyor (Ltd Modus 500 USD).
--   • SWIFT masrafı yüzünden eksik gelen 15-20 EUR/USD, siparişin sonsuza kadar
--     "açık bakiye" görünmesine yol açıyor.
--
-- ── MODEL ─────────────────────────────────────────────────────────────────────
--   payments             : bankaya/kasaya GİREN tek bir para hareketi.
--   payment_allocations  : o paranın hangi siparişe/alacağa ne kadar dağıtıldığı.
--   manual_receivables   : sistemde siparişi olmayan, elle takip edilen alacaklar
--                          (İnci Hanım'ın listeleri — Fentinova, Ptp vb.).
--
-- Bir ödeme birden fazla siparişe bölünebilir. Dağıtılmayan kısım MÜŞTERİ AVANSI
-- olarak bekler ve sonraki siparişe ayrı bir dağıtım satırıyla mahsup edilir.
--
-- orders.advance_payment ve orders.remaining_balance ARTIK ELLE YAZILMAZ;
-- aşağıdaki trigger bunları dağıtımlardan hesaplar. Böylece Dashboard, Takip
-- Takvimi ve Siparişler ekranı hiç değişmeden çalışmaya devam eder.
-- DİKKAT: Siparişler modülündeki Excel içe aktarma hâlâ advance_payment yazıyor;
-- arayüz fazında o alan salt-okunur yapılacak ve içe aktarma bu deftere yazacak.
--
-- ── VADE ──────────────────────────────────────────────────────────────────────
-- Vade FATURA tarihinden işler (kullanıcı teyidi, 16.09.2026). Siparişte fatura
-- tarihi alanı yoktu; bu migration ekliyor. Mevcut kayıtlarda vade elle
-- "sevk + 60/90 gün" olarak girilmiş; geçmişin fatura tarihiyle doldurulması
-- ayrı bir temizlik scriptinde, önce listelenip onaylanarak yapılacak.

-- ============================================================
-- 1) orders — fatura bilgisi
-- ============================================================
alter table orders
    add column if not exists invoice_date date,
    add column if not exists invoice_no   text;

comment on column orders.invoice_date is
    'Fatura tarihi. Vade bu tarihten işler (vade = invoice_date + ödeme şeklindeki gün sayısı). Boşsa uygulama sevk tarihini kullanır.';

create index if not exists orders_invoice_date_idx on orders (invoice_date);

-- ============================================================
-- 2) payments — tahsilat (giren para)
-- ============================================================
create table if not exists payments (
    id                uuid primary key default gen_random_uuid(),
    user_id           uuid not null,
    customer_id       uuid references customers(id) on delete restrict,

    -- Valör tarihi. Yalnızca açılış kayıtlarında boş olabilir (geçmiş ödemelerin
    -- tarihi hiç tutulmamıştı; tarihli giriş 16.09.2026'dan itibaren başlıyor).
    payment_date      date,
    is_opening        boolean not null default false,

    -- Alacağın para birimi = dağıtılan tutarın para birimi.
    currency          text not null default 'EUR',
    amount            numeric(14,2) not null,

    -- İhraç kayıtlı satışta döviz fatura, anlaşılan banka kuruyla TL tahsil
    -- edilebiliyor. Para fiilen hangi birimde/kurla geldiyse burada durur;
    -- alacak yine kendi para biriminden (currency/amount) kapanır.
    received_currency text,
    received_amount   numeric(14,2),
    fx_rate           numeric(14,6),
    fx_note           text,

    method            text,
    bank_account      text,
    reference_no      text,
    notes             text,

    created_at        timestamptz not null default now(),
    created_by        uuid,

    constraint payments_currency_chk
        check (currency in ('EUR', 'USD', 'TRY', 'GBP')),
    constraint payments_received_currency_chk
        check (received_currency is null or received_currency in ('EUR', 'USD', 'TRY', 'GBP')),
    -- İade (Elallar 2025-01: iptal edilen siparişin avansı geri ödendi) eksi
    -- tutarla kaydedilir; sıfır tutarlı hareket anlamsızdır.
    constraint payments_amount_chk  check (amount <> 0),
    constraint payments_date_chk    check (is_opening or payment_date is not null),
    constraint payments_method_chk  check (method is null or method in
        ('Havale/EFT', 'T/T', 'Akreditif (LC)', 'Vesaik (CAD)', 'Çek', 'Nakit', 'Mahsup', 'İade', 'Açılış'))
);

comment on table payments is
    'Tahsilat defteri: bankaya/kasaya giren tek bir para hareketi. Siparişlere payment_allocations ile dağıtılır.';
comment on column payments.is_opening is
    'true: 022 migration''ının oluşturduğu, tarihi bilinmeyen geçmiş bakiye kaydı. Raporlarda "tarihsiz açılış" olarak ayrılır.';
comment on column payments.amount is
    'Ödemenin currency cinsinden toplam tutarı. Siparişlere dağıtılmayan kısım müşteri avansı olarak bekler.';

create index if not exists payments_user_date_idx on payments (user_id, payment_date desc);
create index if not exists payments_customer_idx  on payments (customer_id);

-- ============================================================
-- 3) payment_allocations — ödemenin dağıtımı
-- ============================================================
create table if not exists payment_allocations (
    id               uuid primary key default gen_random_uuid(),
    payment_id       uuid not null references payments(id) on delete cascade,
    order_id         uuid references orders(id) on delete cascade,
    receivable_id    uuid,

    -- Bu dağıtımla siparişe uygulanan NAKİT tutar.
    amount           numeric(14,2) not null default 0,

    -- Nakit girmediği hâlde bakiyeyi kapatan tutar: SWIFT/muhabir banka masrafı
    -- (müşteriden talep edilmiyor), küsurat, kur farkı, CN mahsubu.
    -- Örnek: 17.752 USD beklenirken 17.732 geldi -> amount 17.732, write_off 20
    -- (Banka Kesintisi). Sipariş tam kapanır, kesinti ayrıca raporlanır.
    write_off_amount numeric(14,2) not null default 0,
    write_off_type   text,
    notes            text,

    created_at       timestamptz not null default now(),

    constraint payment_allocations_target_chk
        check (num_nonnulls(order_id, receivable_id) = 1),
    constraint payment_allocations_nonzero_chk
        check (amount <> 0 or write_off_amount <> 0),
    constraint payment_allocations_write_off_type_chk
        check (write_off_amount = 0 or write_off_type in
            ('Banka Kesintisi', 'Kur Farkı', 'Küsurat', 'CN Mahsubu', 'Diğer'))
);

comment on table payment_allocations is
    'Bir tahsilatın hangi siparişe (order_id) veya manuel alacağa (receivable_id) ne kadar sayıldığı. Bir ödeme birden çok satır üretebilir.';

create index if not exists payment_allocations_payment_idx    on payment_allocations (payment_id);
create index if not exists payment_allocations_order_idx      on payment_allocations (order_id);
create index if not exists payment_allocations_receivable_idx on payment_allocations (receivable_id);
create index if not exists payment_allocations_write_off_idx
    on payment_allocations (write_off_type) where write_off_amount <> 0;

-- ============================================================
-- 4) manual_receivables — sistemde siparişi olmayan alacaklar
--    (İnci Hanım'ın elle tuttuğu listeler: Fentinova, Ptp vb.)
-- ============================================================
create table if not exists manual_receivables (
    id            uuid primary key default gen_random_uuid(),
    user_id       uuid not null,
    customer_id   uuid references customers(id) on delete restrict,

    -- Müşteri kartı henüz açılmamış olabilir; o zaman serbest isim kullanılır.
    customer_text text,

    doc_no        text,
    doc_date      date,
    due_date      date,
    currency      text not null default 'EUR',
    amount        numeric(14,2) not null,
    description   text,
    status        text not null default 'Açık',
    created_at    timestamptz not null default now(),

    constraint manual_receivables_currency_chk check (currency in ('EUR', 'USD', 'TRY', 'GBP')),
    constraint manual_receivables_status_chk   check (status in ('Açık', 'Kapandı', 'Şüpheli', 'İptal')),
    constraint manual_receivables_who_chk      check (customer_id is not null or customer_text is not null)
);

comment on table manual_receivables is
    'Siparişe bağlı olmayan cari alacaklar (açık hesap, eski dönem borçları, yansıtmalar). Tahsilatlar payment_allocations.receivable_id ile bunlara da dağıtılabilir.';

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'fk_payment_allocations_receivable') then
        alter table payment_allocations
            add constraint fk_payment_allocations_receivable
            foreign key (receivable_id) references manual_receivables(id) on delete cascade;
    end if;
end $$;

create index if not exists manual_receivables_customer_idx on manual_receivables (customer_id);
create index if not exists manual_receivables_open_idx     on manual_receivables (user_id, due_date) where status = 'Açık';

-- ============================================================
-- 5) Sipariş bakiyesini dağıtımlardan hesaplayan trigger
--    advance_payment   = dağıtılan nakit + kapatılan kesinti
--    remaining_balance = total_amount - advance_payment
-- ============================================================
create or replace function recalc_order_payment_totals(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_paid  numeric(14,2);
    v_total numeric(14,2);
begin
    if p_order_id is null then return; end if;

    select coalesce(sum(amount + write_off_amount), 0)
      into v_paid
      from payment_allocations
     where order_id = p_order_id;

    select coalesce(total_amount, 0) into v_total from orders where id = p_order_id;

    update orders
       set advance_payment   = v_paid,
           remaining_balance = round(v_total - v_paid, 2)
     where id = p_order_id;
end;
$$;

comment on function recalc_order_payment_totals(uuid) is
    'orders.advance_payment / remaining_balance alanlarını tahsilat dağıtımlarından yeniden hesaplar. security definer: yalnızca Ödeme Takibi yetkisi olan kullanıcı da tahsilat girebilsin diye.';

create or replace function payment_allocations_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if TG_OP in ('INSERT', 'UPDATE') then
        perform recalc_order_payment_totals(new.order_id);
    end if;
    if TG_OP in ('UPDATE', 'DELETE') then
        perform recalc_order_payment_totals(old.order_id);
    end if;
    return null;
end;
$$;

drop trigger if exists payment_allocations_sync_trg on payment_allocations;
create trigger payment_allocations_sync_trg
    after insert or update or delete on payment_allocations
    for each row execute function payment_allocations_sync();

-- ============================================================
-- 6) AÇILIŞ BAKİYELERİ — mevcut avanslar deftere taşınır
--    Rakamlar birebir korunur; sadece "tarihi bilinmiyor" işaretlenir.
--    Guard: payments tablosunda tek bir kayıt bile varsa blok hiç çalışmaz.
-- ============================================================
do $$
declare
    r           record;
    v_2ag_order uuid := null;
    v_pay       uuid;
begin
    if exists (select 1 from payments) then
        raise notice 'payments tablosunda kayıt var — açılış aktarımı atlandı.';
        return;
    end if;

    -- 6a) 2ag Otomotıv 2026-02: iki taksitin tarihi biliniyor (04.09 + 15.09.2026),
    --     bu yüzden açılış kaydı yerine GERÇEK tarihli iki tahsilat yazılıyor.
    for r in
        select o.id, o.user_id, o.customer_id
          from orders o
          join customers c on c.id = o.customer_id
         where o.order_number = '2026-02'
           and lower(c.company_name) like '2ag%'
         limit 1
    loop
        v_2ag_order := r.id;

        insert into payments (user_id, customer_id, payment_date, currency, amount, method, notes)
        values (r.user_id, r.customer_id, date '2026-09-04', 'USD', 17752, 'Havale/EFT',
                '2026-02 siparişi 1. ödeme')
        returning id into v_pay;
        insert into payment_allocations (payment_id, order_id, amount)
        values (v_pay, r.id, 17752);

        insert into payments (user_id, customer_id, payment_date, currency, amount, method, notes)
        values (r.user_id, r.customer_id, date '2026-09-15', 'USD', 17752, 'Havale/EFT',
                '2026-02 siparişi 2. ödeme (bakiye)')
        returning id into v_pay;
        insert into payment_allocations (payment_id, order_id, amount)
        values (v_pay, r.id, 17752);
    end loop;

    -- 6b) Diğer tüm siparişler: mevcut avans, o siparişe bağlı tek bir
    --     TARİHSİZ açılış kaydına dönüşür (sipariş başına bir ödeme + bir dağıtım).
    for r in
        select o.id, o.user_id, o.customer_id, o.order_number,
               coalesce(o.currency, 'EUR') as currency,
               round(o.advance_payment, 2) as advance
          from orders o
         where coalesce(o.advance_payment, 0) <> 0
           and (v_2ag_order is null or o.id <> v_2ag_order)
    loop
        insert into payments (user_id, customer_id, payment_date, is_opening,
                              currency, amount, method, notes)
        values (r.user_id, r.customer_id, null, true,
                r.currency, r.advance, 'Açılış',
                'Açılış bakiyesi — ' || coalesce(r.order_number, '?') ||
                ' (ödeme tarihi sistemde tutulmuyordu)')
        returning id into v_pay;

        insert into payment_allocations (payment_id, order_id, amount)
        values (v_pay, r.id, r.advance);
    end loop;
end $$;

-- ============================================================
-- 7) RLS — 003_module_scoped_rls.sql kalıbı
-- ============================================================
alter table payments            enable row level security;
alter table payment_allocations enable row level security;
alter table manual_receivables  enable row level security;

-- Sipariş kartında ödeme geçmişi görünecek: 'orders' de okuyabilmeli.
drop policy if exists payments_select on payments;
create policy payments_select on payments for select
    using (has_module_access(user_id, array['payments','orders','customer-score'], 'view'));
drop policy if exists payments_insert on payments;
create policy payments_insert on payments for insert
    with check (has_module_access(user_id, array['payments'], 'edit'));
drop policy if exists payments_update on payments;
create policy payments_update on payments for update
    using (has_module_access(user_id, array['payments'], 'edit'))
    with check (has_module_access(user_id, array['payments'], 'edit'));
drop policy if exists payments_delete on payments;
create policy payments_delete on payments for delete
    using (has_module_access(user_id, array['payments'], 'edit'));

drop policy if exists payment_allocations_select on payment_allocations;
create policy payment_allocations_select on payment_allocations for select
    using (exists (select 1 from payments p
                    where p.id = payment_allocations.payment_id
                      and has_module_access(p.user_id, array['payments','orders','customer-score'], 'view')));
drop policy if exists payment_allocations_insert on payment_allocations;
create policy payment_allocations_insert on payment_allocations for insert
    with check (exists (select 1 from payments p
                    where p.id = payment_allocations.payment_id
                      and has_module_access(p.user_id, array['payments'], 'edit')));
drop policy if exists payment_allocations_update on payment_allocations;
create policy payment_allocations_update on payment_allocations for update
    using (exists (select 1 from payments p
                    where p.id = payment_allocations.payment_id
                      and has_module_access(p.user_id, array['payments'], 'edit')))
    with check (exists (select 1 from payments p
                    where p.id = payment_allocations.payment_id
                      and has_module_access(p.user_id, array['payments'], 'edit')));
drop policy if exists payment_allocations_delete on payment_allocations;
create policy payment_allocations_delete on payment_allocations for delete
    using (exists (select 1 from payments p
                    where p.id = payment_allocations.payment_id
                      and has_module_access(p.user_id, array['payments'], 'edit')));

drop policy if exists manual_receivables_select on manual_receivables;
create policy manual_receivables_select on manual_receivables for select
    using (has_module_access(user_id, array['payments','customer-score'], 'view'));
drop policy if exists manual_receivables_insert on manual_receivables;
create policy manual_receivables_insert on manual_receivables for insert
    with check (has_module_access(user_id, array['payments'], 'edit'));
drop policy if exists manual_receivables_update on manual_receivables;
create policy manual_receivables_update on manual_receivables for update
    using (has_module_access(user_id, array['payments'], 'edit'))
    with check (has_module_access(user_id, array['payments'], 'edit'));
drop policy if exists manual_receivables_delete on manual_receivables;
create policy manual_receivables_delete on manual_receivables for delete
    using (has_module_access(user_id, array['payments'], 'edit'));

-- ============================================================
-- 8) KONTROL — çalıştırdıktan sonra bunları tek tek çalıştırın
-- ============================================================
-- 8a) Açılış aktarımı tam mı? "fark" sütunu her satırda 0,00 olmalı.
-- select c.company_name, o.order_number, o.currency,
--        o.total_amount, o.advance_payment, o.remaining_balance,
--        round(o.total_amount - o.advance_payment - o.remaining_balance, 2) as fark
--   from orders o join customers c on c.id = o.customer_id
--  where coalesce(o.advance_payment, 0) <> 0
--  order by c.company_name, o.order_number;

-- 8b) Defterdeki toplam ile siparişlerdeki toplam tutuyor mu? (para birimi bazında)
-- select p.currency,
--        sum(a.amount + a.write_off_amount) as defter_toplami,
--        (select sum(o2.advance_payment) from orders o2 where o2.currency = p.currency) as siparis_toplami
--   from payments p join payment_allocations a on a.payment_id = p.id
--  group by p.currency;

-- 8c) 2ag Otomotıv 2026-02 iki tarihli ödeme olarak girdi mi? (2 satır, 17.752 + 17.752)
-- select p.payment_date, p.amount, p.method, p.notes
--   from payments p join customers c on c.id = p.customer_id
--  where lower(c.company_name) like '2ag%'
--  order by p.payment_date;
