import{r as A,s as D}from"./navbar-dnmEf3j7.js";import{r as z}from"./auth-BaxU_CVi.js";let g=[],x="all",h="";document.addEventListener("DOMContentLoaded",async()=>{const n=await z();n&&(await A("payments"),C(),await E(n))});function C(){var n,t,i,a;(n=document.getElementById("btn-refresh"))==null||n.addEventListener("click",async()=>{const o=document.querySelector("#btn-refresh i");o==null||o.classList.add("fa-spin");const{data:{session:r}}=await D.auth.getSession();await E(r),o==null||o.classList.remove("fa-spin")}),document.querySelectorAll(".filter-btn").forEach(o=>{o.addEventListener("click",()=>{document.querySelectorAll(".filter-btn").forEach(r=>r.classList.remove("active")),o.classList.add("active"),x=o.dataset.filter,w()})}),(t=document.getElementById("search-input"))==null||t.addEventListener("input",o=>{h=o.target.value.toLowerCase(),w()}),(i=document.getElementById("modal-close"))==null||i.addEventListener("click",B),(a=document.getElementById("order-detail-modal"))==null||a.addEventListener("click",o=>{o.target===document.getElementById("order-detail-modal")&&B()})}async function E(n){try{const[{data:t,error:i},{data:a,error:o}]=await Promise.all([D.from("orders").select(`
                    id, order_number, order_date, due_date, shipment_date,
                    total_amount, advance_payment, remaining_balance,
                    currency, payment_status, production_status,
                    order_quantity, order_notes, customer_id
                `).eq("user_id",n.user.id).order("due_date",{ascending:!0}),D.from("customers").select("id, company_name, country, client_group").eq("user_id",n.user.id)]);if(i)throw i;if(o)throw o;const r={};(a||[]).forEach(e=>{r[e.id]=e}),g=(t||[]).map(e=>({...e,customers:r[e.customer_id]||null})),L(),M(),w(),T()}catch(t){console.error("Ödeme takibi veri hatası:",t.message),O("Veriler yüklenirken bir hata oluştu: "+t.message)}}function F(){return new Date(new Date().toDateString())}function v(n){if((parseFloat(n.remaining_balance)||0)<=0)return"paid";if(!n.due_date)return"month";const i=new Date(n.due_date),a=F(),o=Math.ceil((i-a)/(1e3*60*60*24));return o<0?"overdue":o>=0&&o<=7?"week":o>7&&o<=30?"month":"future"}function _(n){if(!n.due_date)return 0;const t=new Date(n.due_date),i=F();return Math.ceil((i-t)/(1e3*60*60*24))}function p(n,t){const a={USD:"$",EUR:"€",TRY:"₺",GBP:"£"}[t]||t||"",o=parseFloat(n)||0;return a+o.toLocaleString("tr-TR",{minimumFractionDigits:2,maximumFractionDigits:2})}function b(n){return n?new Date(n).toLocaleDateString("tr-TR"):"—"}function $(n){const t={overdue:{label:"Vadesi Geçmiş",cls:"badge-danger",icon:"fa-circle-exclamation"},week:{label:"Bu Hafta Vadeli",cls:"badge-warning",icon:"fa-clock"},month:{label:"Bu Ay Vadeli",cls:"badge-yellow",icon:"fa-calendar"},future:{label:"İleri Vadeli",cls:"",icon:"fa-calendar-plus"},paid:{label:"Tahsil Edildi",cls:"badge-success",icon:"fa-check-circle"}},i=t[n]||t.future;return`<span class="badge ${i.cls}"><i class="fa-solid ${i.icon}" style="font-size:9px;"></i>${i.label}</span>`}function S(n){return{overdue:"row-overdue",week:"row-week",month:"row-month",paid:"row-paid"}[n]||""}function L(){const n=g.filter(d=>(parseFloat(d.remaining_balance)||0)>0),t=g.filter(d=>v(d)==="overdue"),i=g.filter(d=>v(d)==="week"),a={};n.forEach(d=>{const l=d.currency||"USD";a[l]=(a[l]||0)+(parseFloat(d.remaining_balance)||0)});const o={};t.forEach(d=>{const l=d.currency||"USD";o[l]=(o[l]||0)+(parseFloat(d.remaining_balance)||0)});const r={};i.forEach(d=>{const l=d.currency||"USD";r[l]=(r[l]||0)+(parseFloat(d.remaining_balance)||0)});const e=new Date,s=e.getMonth(),c=e.getFullYear(),u=g.filter(d=>{if(d.payment_status!=="Ödendi")return!1;const l=new Date(d.order_date);return l.getMonth()===s&&l.getFullYear()===c}),y={};u.forEach(d=>{const l=d.currency||"USD";y[l]=(y[l]||0)+(parseFloat(d.total_amount)||0)});const m=d=>{const l=Object.entries(d);return l.length===0?'<span style="font-size:20px;font-weight:600;color:#968B7A;">—</span>':l.map(([f,k])=>`<div style="font-size:20px;font-weight:600;color:#1C1A17;letter-spacing:-0.02em;">${p(k,f)}</div>`).join("")};document.getElementById("kpi-grid").innerHTML=`
        <!-- Toplam Açık Bakiye -->
        <div class="kpi-card">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                <div style="width:32px;height:32px;border-radius:8px;background:#F0F4F2;display:flex;align-items:center;justify-content:center;">
                    <i class="fa-solid fa-wallet" style="color:#2D4A3E;font-size:14px;"></i>
                </div>
                <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#968B7A;font-weight:600;">Toplam Açık Bakiye</div>
            </div>
            ${m(a)}
            <div style="font-size:11px;color:#968B7A;margin-top:4px;">${n.length} açık sipariş</div>
        </div>

        <!-- Vadesi Geçmiş -->
        <div class="kpi-card" style="border-left:3px solid #EF4444;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                <div style="width:32px;height:32px;border-radius:8px;background:#FEF2F2;display:flex;align-items:center;justify-content:center;">
                    <i class="fa-solid fa-circle-exclamation" style="color:#EF4444;font-size:14px;"></i>
                </div>
                <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#968B7A;font-weight:600;">Vadesi Geçmiş</div>
            </div>
            ${m(o)}
            <div style="font-size:11px;color:#9F3D3D;margin-top:4px;">${t.length} sipariş kritik</div>
        </div>

        <!-- Bu Hafta Vadeli -->
        <div class="kpi-card" style="border-left:3px solid #F97316;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                <div style="width:32px;height:32px;border-radius:8px;background:#FFF7ED;display:flex;align-items:center;justify-content:center;">
                    <i class="fa-solid fa-clock" style="color:#F97316;font-size:14px;"></i>
                </div>
                <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#968B7A;font-weight:600;">Bu Hafta Vadeli</div>
            </div>
            ${m(r)}
            <div style="font-size:11px;color:#92600A;margin-top:4px;">${i.length} sipariş yaklaşıyor</div>
        </div>

        <!-- Bu Ay Tahsil Edilen -->
        <div class="kpi-card" style="border-left:3px solid #22C55E;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                <div style="width:32px;height:32px;border-radius:8px;background:#F0FDF4;display:flex;align-items:center;justify-content:center;">
                    <i class="fa-solid fa-check-circle" style="color:#22C55E;font-size:14px;"></i>
                </div>
                <div style="font-size:11px;letter-spacing:0.12em;text-transform:uppercase;color:#968B7A;font-weight:600;">Bu Ay Tahsil</div>
            </div>
            ${m(y)}
            <div style="font-size:11px;color:#166534;margin-top:4px;">${u.length} sipariş tamamlandı</div>
        </div>
    `}function M(){const n=g.filter(i=>v(i)==="overdue").sort((i,a)=>new Date(i.due_date)-new Date(a.due_date));document.getElementById("overdue-count").textContent=n.length;const t=document.getElementById("overdue-tbody");if(n.length===0){t.innerHTML=`<tr><td colspan="6" class="text-center py-8" style="color:#22C55E;">
            <i class="fa-solid fa-check-circle" style="margin-right:6px;"></i>Vadesi geçmiş sipariş bulunmuyor.
        </td></tr>`;return}t.innerHTML=n.map(i=>{var e;const a=((e=i.customers)==null?void 0:e.company_name)||"—",o=_(i),r=parseFloat(i.remaining_balance)||0;return`
            <tr class="row-overdue" style="cursor:pointer;" onclick="showOrderDetail(${JSON.stringify(JSON.stringify(i))})">
                <td style="font-weight:500;">${a}</td>
                <td style="font-family:'DM Mono',monospace;font-size:12px;">${i.order_number||"—"}</td>
                <td>${b(i.due_date)}</td>
                <td><span class="badge badge-danger"><i class="fa-solid fa-clock" style="font-size:9px;"></i>${o} Gün Gecikti</span></td>
                <td style="font-weight:600;color:#9F3D3D;">${p(r,i.currency)}</td>
                <td><span style="font-size:11px;font-weight:600;color:#6B655B;">${i.currency||"—"}</span></td>
            </tr>`}).join("")}function w(){let n=g.filter(r=>{const e=v(r);return x==="all"?e!=="paid"&&e!=="future":x==="overdue"?e==="overdue":x==="week"?e==="week":x==="month"?e==="month":!0});h&&(n=n.filter(r=>{var c;const e=(((c=r.customers)==null?void 0:c.company_name)||"").toLowerCase(),s=(r.order_number||"").toLowerCase();return e.includes(h)||s.includes(h)}));const t={overdue:0,week:1,month:2,future:3,paid:4};n.sort((r,e)=>{const s=t[v(r)]??9,c=t[v(e)]??9;return s!==c?s-c:new Date(r.due_date)-new Date(e.due_date)});const i=document.getElementById("all-open-tbody");if(n.length===0){i.innerHTML='<tr><td colspan="9" class="text-center py-8" style="color:#968B7A;">Kriterlere uygun kayıt bulunamadı.</td></tr>',document.getElementById("table-summary").textContent="";return}const a={};n.forEach(r=>{const e=r.currency||"USD";a[e]=(a[e]||0)+(parseFloat(r.remaining_balance)||0)});const o=Object.entries(a).map(([r,e])=>p(e,r)).join(" + ");document.getElementById("table-summary").textContent=`${n.length} kayıt · Toplam: ${o}`,i.innerHTML=n.map(r=>{var m;const e=v(r),s=((m=r.customers)==null?void 0:m.company_name)||"—",c=parseFloat(r.remaining_balance)||0,u=parseFloat(r.advance_payment)||0,y=parseFloat(r.total_amount)||0;return`
            <tr class="${S(e)}" style="cursor:pointer;" onclick="showOrderDetail(${JSON.stringify(JSON.stringify(r))})">
                <td>${$(e)}</td>
                <td style="font-weight:500;">${s}</td>
                <td style="font-family:'DM Mono',monospace;font-size:12px;">${r.order_number||"—"}</td>
                <td>${b(r.due_date)}</td>
                <td>${p(y,r.currency)}</td>
                <td style="color:#166534;">${p(u,r.currency)}</td>
                <td style="font-weight:600;color:${e==="overdue"?"#9F3D3D":"#1C1A17"};">${p(c,r.currency)}</td>
                <td><span style="font-size:11px;font-weight:600;color:#6B655B;">${r.currency||"—"}</span></td>
                <td style="text-align:center;">
                    <button style="background:none;border:none;cursor:pointer;color:#2D4A3E;font-size:13px;" title="Detay">
                        <i class="fa-solid fa-arrow-right-to-bracket"></i>
                    </button>
                </td>
            </tr>`}).join("")}function T(){const n=g.filter(e=>(parseFloat(e.remaining_balance)||0)>0),t={};n.forEach(e=>{var y;const s=e.customer_id,c=((y=e.customers)==null?void 0:y.company_name)||"Bilinmeyen";t[s]||(t[s]={company_name:c,orders:[],oldestDue:null,byCurrency:{}}),t[s].orders.push(e);const u=e.currency||"USD";if(t[s].byCurrency[u]=(t[s].byCurrency[u]||0)+(parseFloat(e.remaining_balance)||0),e.due_date){const m=new Date(e.due_date);(!t[s].oldestDue||m<t[s].oldestDue)&&(t[s].oldestDue=m)}});function i(e){return(e.USD||0)+(e.EUR||0)*1.08+(e.GBP||0)*1.27}function a(e){const s=i(e);return s>1e4?"A":s>=1e3?"B":"C"}const o=Object.values(t).sort((e,s)=>i(s.byCurrency)-i(e.byCurrency)),r=document.getElementById("customer-tbody");if(o.length===0){r.innerHTML='<tr><td colspan="7" class="text-center py-8" style="color:#968B7A;">Açık bakiyeli sipariş bulunamadı.</td></tr>';return}r.innerHTML=o.map(e=>{const s=a(e.byCurrency),c={A:"abc-a",B:"abc-b",C:"abc-c"}[s],u=e.byCurrency.USD?p(e.byCurrency.USD,"USD"):"—",y=e.byCurrency.EUR?p(e.byCurrency.EUR,"EUR"):"—",d=Object.keys(e.byCurrency).filter(f=>f!=="USD"&&f!=="EUR").map(f=>p(e.byCurrency[f],f)).join(", ")||"—";let l="#1C1A17";if(e.oldestDue){const f=Math.ceil((e.oldestDue-F())/864e5);f<0?l="#9F3D3D":f<=7&&(l="#92600A")}return`
            <tr>
                <td><span class="badge ${c}">${s}</span></td>
                <td style="font-weight:500;">${e.company_name}</td>
                <td style="text-align:center;">${e.orders.length}</td>
                <td style="color:${l};">${e.oldestDue?e.oldestDue.toLocaleDateString("tr-TR"):"—"}</td>
                <td style="font-weight:500;">${u}</td>
                <td style="font-weight:500;">${y}</td>
                <td style="color:#968B7A;">${d}</td>
            </tr>`}).join("")}window.showOrderDetail=function(n){var c,u;const t=JSON.parse(n),i=((c=t.customers)==null?void 0:c.company_name)||"—",a=v(t),o=parseFloat(t.remaining_balance)||0,r=parseFloat(t.advance_payment)||0,e=parseFloat(t.total_amount)||0,s=e>0?Math.round(r/e*100):0;document.getElementById("modal-order-title").textContent=`${i} — ${t.order_number||"Sipariş Detayı"}`,document.getElementById("modal-body").innerHTML=`
        <!-- Sol sütun -->
        <div style="display:flex;flex-direction:column;gap:16px;">
            <div>
                <div style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#968B7A;margin-bottom:6px;">Durum</div>
                ${$(a)}
            </div>
            <div class="grid grid-cols-2 gap-4">
                <div>
                    <div style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#968B7A;margin-bottom:3px;">Sipariş Tarihi</div>
                    <div style="font-size:14px;color:#1C1A17;">${b(t.order_date)}</div>
                </div>
                <div>
                    <div style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#968B7A;margin-bottom:3px;">Vade Tarihi</div>
                    <div style="font-size:14px;color:${a==="overdue"?"#9F3D3D":"#1C1A17"};font-weight:${a==="overdue"?"600":"400"};">${b(t.due_date)}</div>
                </div>
                <div>
                    <div style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#968B7A;margin-bottom:3px;">Sevk Tarihi</div>
                    <div style="font-size:14px;color:#1C1A17;">${b(t.shipment_date)}</div>
                </div>
                <div>
                    <div style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#968B7A;margin-bottom:3px;">Para Birimi</div>
                    <div style="font-size:14px;font-weight:600;color:#1C1A17;">${t.currency||"—"}</div>
                </div>
            </div>
            ${a==="overdue"?`
            <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:12px;display:flex;align-items:center;gap:8px;">
                <i class="fa-solid fa-triangle-exclamation" style="color:#EF4444;"></i>
                <div style="font-size:13px;color:#9F3D3D;font-weight:500;">${_(t)} gün vadesi geçti!</div>
            </div>`:""}
            ${t.order_notes?`
            <div>
                <div style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#968B7A;margin-bottom:6px;">Sipariş Notu</div>
                <div style="font-size:13px;color:#6B655B;background:#FDFAF5;border:1px solid #EFEAE0;border-radius:6px;padding:10px;">${t.order_notes}</div>
            </div>`:""}
        </div>

        <!-- Sağ sütun -->
        <div style="display:flex;flex-direction:column;gap:16px;">
            <!-- Finansal özet -->
            <div style="background:#FDFAF5;border:1px solid #EFEAE0;border-radius:10px;padding:16px;">
                <div style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#968B7A;margin-bottom:12px;">Finansal Özet</div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <span style="font-size:13px;color:#6B655B;">Toplam Tutar</span>
                    <span style="font-size:15px;font-weight:600;color:#1C1A17;">${p(e,t.currency)}</span>
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <span style="font-size:13px;color:#6B655B;">Ödenen</span>
                    <span style="font-size:15px;font-weight:600;color:#166534;">${p(r,t.currency)}</span>
                </div>
                <div style="height:1px;background:#EFEAE0;margin:10px 0;"></div>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                    <span style="font-size:13px;font-weight:600;color:#1C1A17;">Kalan Bakiye</span>
                    <span style="font-size:18px;font-weight:700;color:${a==="overdue"?"#9F3D3D":"#2D4A3E"};">${p(o,t.currency)}</span>
                </div>
                <!-- Progress bar -->
                <div style="height:6px;background:#EFEAE0;border-radius:999px;overflow:hidden;">
                    <div style="height:100%;width:${s}%;background:#22C55E;border-radius:999px;transition:width .3s;"></div>
                </div>
                <div style="font-size:11px;color:#968B7A;margin-top:4px;text-align:right;">%${s} tahsil edildi</div>
            </div>

            <div class="grid grid-cols-2 gap-3">
                <div style="background:#F0F4F2;border-radius:8px;padding:12px;">
                    <div style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#968B7A;margin-bottom:4px;">Üretim Durumu</div>
                    <div style="font-size:13px;font-weight:500;color:#2D4A3E;">${t.production_status||"—"}</div>
                </div>
                <div style="background:#F0F4F2;border-radius:8px;padding:12px;">
                    <div style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#968B7A;margin-bottom:4px;">Ödeme Durumu</div>
                    <div style="font-size:13px;font-weight:500;color:#2D4A3E;">${t.payment_status||"—"}</div>
                </div>
                <div style="background:#F0F4F2;border-radius:8px;padding:12px;">
                    <div style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#968B7A;margin-bottom:4px;">Sipariş Adedi</div>
                    <div style="font-size:13px;font-weight:500;color:#1C1A17;">${t.order_quantity||"—"}</div>
                </div>
                <div style="background:#F0F4F2;border-radius:8px;padding:12px;">
                    <div style="font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#968B7A;margin-bottom:4px;">Müşteri Grubu</div>
                    <div style="font-size:13px;font-weight:500;color:#1C1A17;">${((u=t.customers)==null?void 0:u.client_group)||"—"}</div>
                </div>
            </div>
        </div>
    `,document.getElementById("order-detail-modal").classList.remove("hidden")};function B(){document.getElementById("order-detail-modal").classList.add("hidden")}function O(n){document.getElementById("kpi-grid").innerHTML=`
        <div class="kpi-card" style="grid-column:1/-1;color:#9F3D3D;text-align:center;">
            <i class="fa-solid fa-triangle-exclamation" style="margin-right:8px;"></i>${n}
        </div>`}
