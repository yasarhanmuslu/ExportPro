import{a as p,r as f,s as i}from"./auth-BknLIeSq.js";/* empty css              */let d=[];document.addEventListener("DOMContentLoaded",async()=>{await p()&&(await f("customers"),await m(),b())});async function m(){try{const{data:{session:n}}=await i.auth.getSession();if(!n)return;const{data:e,error:t}=await i.from("customers").select("*").order("country",{ascending:!0}).order("company_name",{ascending:!0});if(t)throw t;d=e,x(e),y(e)}catch(n){console.error("Müşteri listesi çekilemedi:",n.message),alert("Müşteri verileri yüklenirken hata oluştu.")}}function y(n){const e=document.getElementById("customers-list-container");if(e.innerHTML="",n.length===0){e.innerHTML=`
            <div class="text-center py-12 bg-slate-900/20 border border-slate-800 border-dashed rounded-xl">
                <i class="fa-solid fa-users-slash text-slate-600 text-3xl mb-3"></i>
                <p class="text-slate-500 text-sm">Kriterlere uygun müşteri kaydı bulunamadı.</p>
            </div>`;return}const t={};n.forEach(a=>{const o=a.country.trim();t[o]||(t[o]=[]),t[o].push(a)}),Object.keys(t).forEach(a=>{const o=t[a].length,r=document.createElement("div");r.className="bg-slate-900/40 border border-slate-800 rounded-xl overflow-hidden shadow-md",r.innerHTML=`
            <div class="bg-slate-900/80 px-6 py-4 flex items-center justify-between cursor-pointer border-b border-slate-800/60 select-none toggle-group-btn">
                <div class="flex items-center gap-3">
                    <i class="fa-solid fa-chevron-down text-xs text-slate-500 transition-transform duration-200"></i>
                    <span class="font-bold text-white tracking-wide">${a.toUpperCase()}</span>
                    <span class="px-2 py-0.5 bg-blue-950 text-blue-400 text-[11px] font-semibold border border-blue-900/50 rounded-full">${o} Müşteri</span>
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
                            <th>Kayıt Tarihi</th>
                            <th class="text-right">İşlem</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${t[a].map(s=>`
                            <tr>
                                <td class="font-medium text-slate-200">${l(s.company_name)}</td>
                                <td class="text-slate-300">${l(s.contact_name||"—")}</td>
                                <td>
                                    <div class="text-xs">${l(s.email||"—")}</div>
                                    <div class="text-xs text-slate-500">${l(s.phone||"")}</div>
                                </td>
                                <td>
                                    <span class="px-2.5 py-1 rounded-md text-xs font-medium border ${B(s.client_group)}">
                                        ${s.client_group||"Standart"}
                                    </span>
                                </td>
                                <td>
                                    <span class="px-2 py-0.5 rounded text-xs font-semibold ${w(s.status)}">
                                        ${s.status||"Aktif"}
                                    </span>
                                </td>
                                <td class="text-slate-400 text-xs">${new Date(s.created_at).toLocaleDateString("tr-TR")}</td>
                                <td class="text-right">
                                    <button class="btn-edit-trigger text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-600 px-3 py-1.5 rounded-md text-blue-400 transition-colors" data-id="${s.id}">
                                        <i class="fa-solid fa-pen-to-square"></i> Düzenle
                                    </button>
                                </td>
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            </div>
        `,e.appendChild(r)}),e.querySelectorAll(".toggle-group-btn").forEach(a=>{a.addEventListener("click",()=>{const o=a.nextElementSibling,r=a.querySelector(".fa-chevron-down");o.classList.toggle("hidden"),r.classList.toggle("-rotate-90")})}),e.querySelectorAll(".btn-edit-trigger").forEach(a=>{a.addEventListener("click",o=>{const r=o.currentTarget.getAttribute("data-id");v(r)})})}function b(){document.getElementById("btn-open-modal").addEventListener("click",()=>_()),document.getElementById("btn-close-modal").addEventListener("click",c),document.getElementById("btn-cancel").addEventListener("click",c),document.getElementById("customer-form").addEventListener("submit",E),document.getElementById("btn-delete-customer").addEventListener("click",I),document.getElementById("search-input").addEventListener("input",u),document.getElementById("filter-country").addEventListener("change",u),document.getElementById("filter-group").addEventListener("change",u),document.getElementById("btn-export-excel").addEventListener("click",S),L()}function _(){document.getElementById("customer-form").reset(),document.getElementById("customer-id").value="",document.getElementById("modal-title").innerHTML='<i class="fa-solid fa-user-plus text-blue-500"></i> Yeni Müşteri Kaydı',document.getElementById("btn-delete-customer").classList.add("hidden"),document.getElementById("customer-modal").classList.remove("hidden")}function v(n){const e=d.find(t=>t.id===n);e&&(document.getElementById("customer-id").value=e.id,document.getElementById("company_name").value=e.company_name||"",document.getElementById("country").value=e.country||"",document.getElementById("contact_name").value=e.contact_name||"",document.getElementById("email").value=e.email||"",document.getElementById("phone").value=e.phone||"",document.getElementById("website").value=e.website||"",document.getElementById("client_group").value=e.client_group||"Standart",document.getElementById("status").value=e.status||"Aktif",document.getElementById("history_date_1").value=e.history_date_1||"",document.getElementById("history_note_1").value=e.history_note_1||"",document.getElementById("history_date_2").value=e.history_date_2||"",document.getElementById("history_note_2").value=e.history_note_2||"",document.getElementById("history_date_3").value=e.history_date_3||"",document.getElementById("history_note_3").value=e.history_note_3||"",document.getElementById("modal-title").innerHTML='<i class="fa-solid fa-pen-to-square text-amber-500"></i> Müşteri Kaydını Düzenle',document.getElementById("btn-delete-customer").classList.remove("hidden"),document.getElementById("customer-modal").classList.remove("hidden"))}function c(){document.getElementById("customer-modal").classList.add("hidden")}async function E(n){n.preventDefault();const e=document.getElementById("customer-id").value,t=o=>{const r=document.getElementById(o).value.trim();return r?g(r):null},a={company_name:t("company_name"),country:t("country"),contact_name:t("contact_name"),email:document.getElementById("email").value.trim()||null,phone:t("phone"),website:t("website"),client_group:document.getElementById("client_group").value,status:document.getElementById("status").value,history_date_1:document.getElementById("history_date_1").value||null,history_note_1:t("history_note_1"),history_date_2:document.getElementById("history_date_2").value||null,history_note_2:t("history_note_2"),history_date_3:document.getElementById("history_date_3").value||null,history_note_3:t("history_note_3"),updated_at:new Date().toISOString()};try{const{data:{session:o}}=await i.auth.getSession();if(!o)throw new Error("Oturum bulunamadı.");const r=o.user.id;if(e){const{error:s}=await i.from("customers").update(a).eq("id",e).eq("user_id",r);if(s)throw s}else{const{error:s}=await i.from("customers").insert([{...a,user_id:r}]);if(s)throw s}c(),await m()}catch(o){console.error("Müşteri kaydedilemedi:",o.message),alert("Kayıt sırasında bir hata oluştu: "+o.message)}}async function I(){const n=document.getElementById("customer-id").value;if(n&&confirm("Bu müşteriyi silmek istediğinize emin misiniz? Bu işlem müşteriye bağlı tüm sipariş ve fiyat ilişkilerini de etkileyebilir!"))try{const{data:{session:e}}=await i.auth.getSession(),{error:t}=await i.from("customers").delete().eq("id",n).eq("user_id",e.user.id);if(t)throw t;c(),await m()}catch(e){console.error("Müşteri silinemedi:",e.message),alert("Silme işlemi başarısız oldu.")}}function u(){const n=document.getElementById("search-input").value.toLowerCase(),e=document.getElementById("filter-country").value,t=document.getElementById("filter-group").value,a=d.filter(o=>{const r=o.company_name.toLowerCase().includes(n)||o.country.toLowerCase().includes(n)||(o.contact_name||"").toLowerCase().includes(n),s=e===""||o.country===e,h=t===""||o.client_group===t;return r&&s&&h});y(a)}function x(n){const e=document.getElementById("filter-country"),t=e.value,a=[...new Set(n.map(o=>o.country))].sort();e.innerHTML='<option value="">Tüm Ülkeler (Filtrele)</option>',a.forEach(o=>{const r=document.createElement("option");r.value=o,r.textContent=o,e.appendChild(r)}),e.value=t}function B(n){switch(n){case"VIP":return"bg-amber-950/40 text-amber-400 border-amber-900/50";case"Stratejik":return"bg-purple-950/40 text-purple-400 border-purple-900/50";case"Potansiyel":return"bg-rose-950/40 text-rose-400 border-rose-900/50";default:return"bg-slate-800 text-slate-400 border-slate-700/60"}}function w(n){switch(n){case"Aktif":return"bg-emerald-950/50 text-emerald-400";case"Pasif":return"bg-slate-800 text-slate-500";case"Potansiyel":return"bg-amber-950/40 text-amber-400";default:return"bg-emerald-950/50 text-emerald-400"}}function l(n){return n?n.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;"):""}function g(n){if(!n)return n;const e=n.toLocaleLowerCase("tr-TR");return e.charAt(0).toLocaleUpperCase("tr-TR")+e.slice(1)}function L(){["company_name","country","contact_name","phone","website","history_note_1","history_note_2","history_note_3"].forEach(e=>{const t=document.getElementById(e);t&&t.addEventListener("input",function(){const a=this.selectionStart,o=this.selectionEnd,r=this.value,s=g(r);r!==s&&(this.value=s,this.setSelectionRange(a,o))})})}function S(){if(d.length===0){alert("Dışa aktarılacak veri bulunamadı.");return}let n="data:text/csv;charset=utf-8,\uFEFF";n+=`Firma Adı;Ülke;Yetkili;E-Posta;Telefon;Web;Müşteri Tipi;Durum;Kayıt Tarihi
`,d.forEach(a=>{const o=new Date(a.created_at).toLocaleDateString("tr-TR"),r=s=>`"${(s||"").toString().replace(/"/g,'""')}"`;n+=[r(a.company_name),r(a.country),r(a.contact_name),r(a.email),r(a.phone),r(a.website),r(a.client_group||"Standart"),r(a.status||"Aktif"),r(o)].join(";")+`
`});const e=encodeURI(n),t=document.createElement("a");t.setAttribute("href",e),t.setAttribute("download",`Export_Musteri_Arsivi_${new Date().toISOString().slice(0,10)}.csv`),document.body.appendChild(t),t.click(),document.body.removeChild(t)}
