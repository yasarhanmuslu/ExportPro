import{r as b,s as m}from"./navbar-dnmEf3j7.js";import{r as _}from"./auth-BaxU_CVi.js";let g=[];document.addEventListener("DOMContentLoaded",async()=>{await _()&&(await b("customers"),await h(),B())});async function h(){try{const{data:{session:t}}=await m.auth.getSession();if(!t)return;const{data:e,error:n}=await m.from("customers").select("*").order("country",{ascending:!0}).order("company_name",{ascending:!0});if(n)throw n;g=e,C(e),E(e)}catch(t){console.error("Müşteri listesi çekilemedi:",t.message),alert("Müşteri verileri yüklenirken hata oluştu.")}}function E(t){const e=document.getElementById("customers-list-container");e.innerHTML="";const n=g.length,o=g.filter(i=>i.status==="Aktif").length,r=t.length,a=t.filter(i=>i.status==="Aktif").length,s=r!==n,y=document.createElement("div");if(y.style.cssText="display:flex;align-items:center;gap:16px;padding:10px 16px;background:var(--surface);border:1px solid var(--border-soft);border-radius:8px;margin-bottom:16px;font-size:12px;",y.innerHTML=`
        <span style="color:var(--ink-3);">
            <i class="fa-solid fa-users" style="margin-right:5px;"></i>
            Toplam: <strong style="color:var(--ink-1);">${s?r+" / "+n:n}</strong>
        </span>
        <span style="width:1px;height:16px;background:var(--border);"></span>
        <span style="color:var(--ok);">
            <i class="fa-solid fa-circle-check" style="margin-right:5px;"></i>
            Aktif: <strong>${s?a+" / "+o:o}</strong>
        </span>
        <span style="width:1px;height:16px;background:var(--border);"></span>
        <span style="color:var(--ink-3);">
            <i class="fa-solid fa-circle-minus" style="margin-right:5px;"></i>
            Pasif: <strong>${s?r-a+" / "+(n-o):n-o}</strong>
        </span>
    `,e.appendChild(y),t.length===0){e.innerHTML=`
            <div class="text-center py-12 bg-[#FBF8F1]/20 border border-[#EFEAE0] border-dashed rounded-xl">
                <i class="fa-solid fa-users-slash text-slate-600 text-3xl mb-3"></i>
                <p class="text-[#968B7A] text-sm">Kriterlere uygun müşteri kaydı bulunamadı.</p>
            </div>`;return}const c={};t.forEach(i=>{const d=i.country.trim();c[d]||(c[d]=[]),c[d].push(i)}),Object.keys(c).forEach(i=>{const d=c[i].length,u=document.createElement("div");u.className="bg-[#FBF8F1]/40 border border-[#EFEAE0] rounded-xl overflow-hidden shadow-md",u.innerHTML=`
            <div class="bg-[#FBF8F1]/80 px-6 py-4 flex items-center justify-between cursor-pointer border-b border-[#EFEAE0]/60 select-none toggle-group-btn">
                <div class="flex items-center gap-3">
                    <i class="fa-solid fa-chevron-down text-xs text-[#968B7A] transition-transform duration-200"></i>
                    <span class="font-bold text-[#1C1A17] tracking-wide">${i.toUpperCase()}</span>
                    <span class="px-2 py-0.5 text-[11px] font-semibold border rounded-full" style="background:var(--accent-soft);color:var(--accent);border-color:rgba(45,74,62,0.20);">${d} Müşteri</span>
                </div>
            </div>
            <div class="custom-table-container border-0 rounded-none transition-all duration-200">
                <table class="custom-table">
                    <thead>
                        <tr>
                            <th>Firma Ünvanı</th>
                            <th>Yetkili</th>
                            <th>E-Posta / Telefon</th>
                            <th>Müşteri Tipi</th>
                            <th>Durum</th>
                            <th>Kısa Bilgi</th>
                            <th style="text-align:right;padding-right:1rem;">İşlem</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${c[i].map(l=>`
                            <tr>
                                <td class="font-medium text-[#1C1A17]">${p(l.company_name)}</td>
                                <td class="text-[#6B655B]">${p(l.contact_name||"—")}</td>
                                <td>
                                    <div class="text-xs">${p(l.email||"—")}</div>
                                    <div class="text-xs text-[#968B7A]">${p(l.phone||"")}</div>
                                </td>
                                <td>
                                    <span class="px-2.5 py-1 rounded-md text-xs font-medium border ${w(l.client_group)}">
                                        ${l.client_group||"Toptancı"}
                                    </span>
                                </td>
                                <td>
                                    <span class="px-2 py-0.5 rounded text-xs font-semibold ${D(l.status)}">
                                        ${l.status||"Aktif"}
                                    </span>
                                </td>
                                <td class="text-[#6B655B] text-xs max-w-[200px]">
                                    <span class="block truncate" title="${p(l.short_info||"")}">${p(l.short_info||"—")}</span>
                                </td>
                                <td class="text-right">
                                    <button class="btn-edit-trigger text-xs bg-[#FBF8F1] hover:bg-slate-700 border border-[#E4DDCE] hover:border-slate-600 px-3 py-1.5 rounded-md text-blue-400 transition-colors" data-id="${l.id}">
                                        <i class="fa-solid fa-pen-to-square"></i> Düzenle
                                    </button>
                                </td>
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            </div>
        `,e.appendChild(u)}),e.querySelectorAll(".toggle-group-btn").forEach(i=>{i.addEventListener("click",()=>{const d=i.nextElementSibling,u=i.querySelector(".fa-chevron-down");d.classList.toggle("hidden"),u.classList.toggle("-rotate-90")})}),e.querySelectorAll(".btn-edit-trigger").forEach(i=>{i.addEventListener("click",d=>{const u=d.currentTarget.getAttribute("data-id");I(u)})})}function B(){document.getElementById("btn-open-modal").addEventListener("click",()=>x()),document.getElementById("btn-close-modal").addEventListener("click",f),document.getElementById("btn-cancel").addEventListener("click",f),document.getElementById("customer-form").addEventListener("submit",k),document.getElementById("btn-delete-customer").addEventListener("click",S),document.getElementById("search-input").addEventListener("input",A),document.getElementById("filter-region").addEventListener("change",A),document.getElementById("filter-country").addEventListener("change",A),document.getElementById("filter-group").addEventListener("change",A),document.getElementById("btn-export-excel").addEventListener("click",F),N()}function x(){document.getElementById("customer-form").reset(),document.getElementById("customer-id").value="",document.getElementById("modal-title").innerHTML='<i class="fa-solid fa-user-plus text-blue-500"></i> Yeni Müşteri Kaydı',document.getElementById("btn-delete-customer").classList.add("hidden"),document.getElementById("customer-modal").classList.remove("hidden")}function I(t){const e=g.find(n=>n.id===t);e&&(document.getElementById("customer-id").value=e.id,document.getElementById("company_name").value=e.company_name||"",document.getElementById("country").value=e.country||"",document.getElementById("contact_name").value=e.contact_name||"",document.getElementById("email").value=e.email||"",document.getElementById("phone").value=e.phone||"",document.getElementById("website").value=e.website||"",document.getElementById("client_group").value=e.client_group||"Standart",document.getElementById("status").value=e.status||"Aktif",document.getElementById("history_date_1").value=e.history_date_1||"",document.getElementById("history_note_1").value=e.history_note_1||"",document.getElementById("history_date_2").value=e.history_date_2||"",document.getElementById("history_note_2").value=e.history_note_2||"",document.getElementById("history_date_3").value=e.history_date_3||"",document.getElementById("history_note_3").value=e.history_note_3||"",document.getElementById("short_info").value=e.short_info||"",document.getElementById("modal-title").innerHTML='<i class="fa-solid fa-pen-to-square text-amber-500"></i> Müşteri Kaydını Düzenle',document.getElementById("btn-delete-customer").classList.remove("hidden"),document.getElementById("customer-modal").classList.remove("hidden"))}function f(){document.getElementById("customer-modal").classList.add("hidden")}async function k(t){t.preventDefault();const e=document.getElementById("customer-id").value,n=r=>{const a=document.getElementById(r).value.trim();return a?v(a):null},o={company_name:n("company_name"),country:n("country"),contact_name:n("contact_name"),email:document.getElementById("email").value.trim()||null,phone:n("phone"),website:n("website"),client_group:document.getElementById("client_group").value,status:document.getElementById("status").value,short_info:document.getElementById("short_info").value.trim()||null,history_date_1:document.getElementById("history_date_1").value||null,history_note_1:n("history_note_1"),history_date_2:document.getElementById("history_date_2").value||null,history_note_2:n("history_note_2"),history_date_3:document.getElementById("history_date_3").value||null,history_note_3:n("history_note_3"),updated_at:new Date().toISOString()};try{const{data:{session:r}}=await m.auth.getSession();if(!r)throw new Error("Oturum bulunamadı.");const a=r.user.id;if(e){const{error:s}=await m.from("customers").update(o).eq("id",e).eq("user_id",a);if(s)throw s}else{const{error:s}=await m.from("customers").insert([{...o,user_id:a}]);if(s)throw s}f(),await h()}catch(r){console.error("Müşteri kaydedilemedi:",r.message),alert("Kayıt sırasında bir hata oluştu: "+r.message)}}async function S(){const t=document.getElementById("customer-id").value;if(t&&confirm("Bu müşteriyi silmek istediğinize emin misiniz? Bu işlem müşteriye bağlı tüm sipariş ve fiyat ilişkilerini de etkileyebilir!"))try{const{data:{session:e}}=await m.auth.getSession(),{error:n}=await m.from("customers").delete().eq("id",t).eq("user_id",e.user.id);if(n)throw n;f(),await h()}catch(e){console.error("Müşteri silinemedi:",e.message),e.code==="23503"?alert(`Bu müşteri silinemez!
Müşteriye ait sipariş, özel fiyat veya credit note kaydı bulunmaktadır.
Önce ilgili kayıtları siliniz.`):alert("Silme işlemi başarısız oldu: "+e.message)}}const L={ALMANYA:"Avrupa",ARNAVUTLUK:"Avrupa",AVUSTRALYA:"Avrupa",AVUSTURYA:"Avrupa","BOSNA HERSEK":"Avrupa",BULGARİSTAN:"Avrupa",ÇEKYA:"Avrupa",ESTONYA:"Avrupa",FRANSA:"Avrupa",HIRVATİSTAN:"Avrupa",İNGİLTERE:"Avrupa",İTALYA:"Avrupa",KARADAĞ:"Avrupa",KOSOVA:"Avrupa",LİTVANYA:"Avrupa",MACARİSTAN:"Avrupa",MAKEDONYA:"Avrupa",MOLDOVA:"Avrupa",ROMANYA:"Avrupa",SIRBİSTAN:"Avrupa",YUNANİSTAN:"Avrupa",AZERBAYCAN:"Asya",GÜRCİSTAN:"Asya",TÜRKİYE:"Asya",TÜRKMENİSTAN:"Asya",KIBRIS:"Asya",RUSYA:"Asya",BANGLADEŞ:"Asya",HİNDİSTAN:"Asya",PAKİSTAN:"Asya","B.A.E":"Orta Doğu",BAHREYN:"Orta Doğu",FİLİSTİN:"Orta Doğu",IRAK:"Orta Doğu",İRAN:"Orta Doğu",İSRAİL:"Orta Doğu",KATAR:"Orta Doğu",KUVEYT:"Orta Doğu",LÜBNAN:"Orta Doğu","SUUDİ ARABİSTAN":"Orta Doğu",UMMAN:"Orta Doğu",ÜRDÜN:"Orta Doğu",CEZAYİR:"Afrika",ETİYOPYA:"Afrika",FAS:"Afrika","FİLDİŞİ SAHİLİ":"Afrika",GANA:"Afrika",GİNE:"Afrika",KAMERUN:"Afrika",LİBYA:"Afrika",MAURİTİUS:"Afrika",MISIR:"Afrika",NİJERYA:"Afrika",SENEGAL:"Afrika",SOMALİ:"Afrika",SUDAN:"Afrika",TUNUS:"Afrika"};function T(t){if(!t)return"Diğer";const e=t.trim().toLocaleUpperCase("tr-TR");return L[e]||"Diğer"}function A(){const t=document.getElementById("search-input").value.toLowerCase(),e=document.getElementById("filter-region").value,n=document.getElementById("filter-country").value,o=document.getElementById("filter-group").value,r=g.filter(a=>{const s=a.company_name.toLowerCase().includes(t)||a.country.toLowerCase().includes(t)||(a.contact_name||"").toLowerCase().includes(t),y=e===""||T(a.country)===e,c=n===""||a.country===n,i=o===""||a.client_group===o;return s&&y&&c&&i});E(r)}function C(t){const e=document.getElementById("filter-country"),n=e.value,o=[...new Set(t.map(r=>r.country))].sort();e.innerHTML='<option value="">Tüm Ülkeler (Filtrele)</option>',o.forEach(r=>{const a=document.createElement("option");a.value=r,a.textContent=r,e.appendChild(a)}),e.value=n}function w(t){switch(t){case"Toptancı":return"bg-[#E8EEEA] text-[#2D4A3E] border-[#C5D5CC]";case"Üretici":return"bg-[#F2E9DA] text-[#B58858] border-[#E4CCAA]";case"Perakendeci":return"bg-[#EAE6F0] text-[#5A4A7A] border-[#C8BEE0]";case"Projeci":return"bg-[#E0E6EE] text-[#3F5C7A] border-[#B8C8DC]";default:return"bg-[#FBF8F1] text-[#6B655B] border-[#E4DDCE]/60"}}function D(t){switch(t){case"Aktif":return"bg-emerald-950/50 text-[#3D6E50]";case"Pasif":return"bg-[#FBF8F1] text-[#968B7A]";case"Potansiyel":return"bg-amber-950/40 text-[#B26B33]";default:return"bg-emerald-950/50 text-[#3D6E50]"}}function p(t){return t?t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;"):""}function v(t){if(!t)return t;const e=t.toLocaleLowerCase("tr-TR");return e.charAt(0).toLocaleUpperCase("tr-TR")+e.slice(1)}function N(){["company_name","country","contact_name","phone","website","history_note_1","history_note_2","history_note_3"].forEach(e=>{const n=document.getElementById(e);n&&n.addEventListener("input",function(){const o=this.selectionStart,r=this.selectionEnd,a=this.value,s=v(a);a!==s&&(this.value=s,this.setSelectionRange(o,r))})})}function F(){if(g.length===0){alert("Dışa aktarılacak veri bulunamadı.");return}let t="data:text/csv;charset=utf-8,\uFEFF";t+=`Firma Adı;Ülke;Yetkili;E-Posta;Telefon;Web;Müşteri Tipi;Durum;Kısa Bilgi
`,g.forEach(o=>{const r=a=>`"${(a||"").toString().replace(/"/g,'""')}"`;t+=[r(o.company_name),r(o.country),r(o.contact_name),r(o.email),r(o.phone),r(o.website),r(o.client_group||"Toptancı"),r(o.status||"Aktif"),r(o.short_info)].join(";")+`
`});const e=encodeURI(t),n=document.createElement("a");n.setAttribute("href",e),n.setAttribute("download",`Export_Musteri_Arsivi_${new Date().toISOString().slice(0,10)}.csv`),document.body.appendChild(n),n.click(),document.body.removeChild(n)}
