-- 035_date_opening_payments.sql
-- Supabase SQL Editor'de BİR KERE çalıştırın. İdempotent (create or replace).
--
-- GEREKÇE
-- 022, geçmiş siparişlerin tahsilatlarını "tarihsiz açılış kaydı" olarak aktardı —
-- o gün ödeme tarihleri sistemde yoktu. Patron arşiv için bu ödemelerin gerçek
-- tarihlerini sonradan girmek istiyor (ör. Temax 2026-03: 500 EUR, 09.06.2026).
-- Sipariş zaten kapalı olduğu için "Tahsilat Gir" ekranında görünmüyor; yeni bir
-- tahsilat girmek de ödemeyi İKİ KEZ saymak olurdu.
--
-- date_opening_payment: tarihsiz açılış kaydını bir ya da birkaç TARİHLİ tahsilata
-- dönüştürür (ör. 2ag gibi iki taksitte gelmiş ödeme). Girilen toplam açılış
-- tutarından azsa kalan kısım açılış kaydı olarak kalır. Siparişin tahsil edilen
-- toplamı DEĞİŞMEZ; sadece ödemenin tarihi, yolu ve referansı kayda geçer.
--
-- Tek işlem (transaction) içinde çalışır: yarıda kalıp ödemeyi çift saymaz.
-- Yalnızca TEK siparişe dağıtılmış açılış kayıtları için (fazla ödeme mahsubu
-- yapılmış, iki siparişe bölünmüş kayıtlar desteklenmez).

create or replace function date_opening_payment(p_payment_id uuid, p_rows jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_p      payments%rowtype;
    v_alloc  payment_allocations%rowtype;
    v_cnt    integer;
    v_total  numeric(14,2) := 0;
    v_amt    numeric(14,2);
    v_new    uuid;
    r        jsonb;
begin
    select * into v_p from payments where id = p_payment_id for update;
    if not found then
        raise exception 'Tahsilat kaydı bulunamadı.';
    end if;
    if not has_module_access(v_p.user_id, array['payments'], 'edit') then
        raise exception 'Bu işlem için Ödeme Takibi düzenleme yetkisi gerekli.';
    end if;
    if not v_p.is_opening then
        raise exception 'Bu kayıt zaten tarihli.';
    end if;
    if v_p.method = 'Mahsup' then
        raise exception 'Mahsup / bedelsiz kapatma kayıtları nakit tahsilat değildir, tarihlendirilemez.';
    end if;

    select count(*) into v_cnt from payment_allocations where payment_id = p_payment_id;
    if v_cnt <> 1 then
        raise exception 'Bu açılış kaydı % siparişe dağıtılmış (fazla ödeme mahsubu). Yalnızca tek siparişe ait kayıtlar tarihlendirilebilir.', v_cnt;
    end if;
    select * into v_alloc from payment_allocations where payment_id = p_payment_id;
    if v_alloc.write_off_amount <> 0 or v_alloc.order_id is null then
        raise exception 'Bu kayıt tarihlendirilemez (kesinti içeriyor ya da siparişe bağlı değil).';
    end if;

    if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
        raise exception 'En az bir ödeme satırı (tarih + tutar) gerekli.';
    end if;

    for r in select * from jsonb_array_elements(p_rows) loop
        v_amt := round(coalesce((r->>'amount')::numeric, 0), 2);
        if v_amt <= 0 or coalesce(r->>'payment_date', '') = '' then
            raise exception 'Her satırda tarih ve sıfırdan büyük tutar olmalı.';
        end if;
        v_total := v_total + v_amt;
    end loop;

    if v_total - v_p.amount > 0.005 then
        raise exception 'Girilen toplam (%) açılış kaydının tutarını (%) aşıyor.', v_total, v_p.amount;
    end if;

    -- Tarihli tahsilatlar
    for r in select * from jsonb_array_elements(p_rows) loop
        v_amt := round((r->>'amount')::numeric, 2);
        insert into payments (user_id, customer_id, payment_date, is_opening, currency, amount,
                              method, bank_account, reference_no, notes, created_by)
        values (v_p.user_id, v_p.customer_id, (r->>'payment_date')::date, false, v_p.currency, v_amt,
                nullif(r->>'method', ''), nullif(r->>'bank_account', ''), nullif(r->>'reference_no', ''),
                coalesce(nullif(r->>'notes', ''), 'Geçmiş ödeme — tarihsiz açılış kaydından tarihlendirildi'),
                auth.uid())
        returning id into v_new;

        insert into payment_allocations (payment_id, order_id, amount)
        values (v_new, v_alloc.order_id, v_amt);
    end loop;

    -- Açılış kaydından düş: tamamı tarihlendiyse sil, değilse kalanı bırak.
    if v_p.amount - v_total <= 0.005 then
        delete from payments where id = p_payment_id;
    else
        update payment_allocations set amount = amount - v_total where id = v_alloc.id;
        update payments set amount = amount - v_total where id = p_payment_id;
    end if;
end;
$$;

revoke all on function date_opening_payment(uuid, jsonb) from public, anon;
grant execute on function date_opening_payment(uuid, jsonb) to authenticated;

comment on function date_opening_payment(uuid, jsonb) is
    'Tarihsiz açılış tahsilatını tarihli tahsilat(lar)a dönüştürür. p_rows: [{payment_date, amount, method, bank_account, reference_no, notes}]. Siparişin tahsil edilen toplamı değişmez.';

-- ============================================================
-- KONTROL — fonksiyon var mı?
-- ============================================================
-- select proname from pg_proc where proname = 'date_opening_payment';
