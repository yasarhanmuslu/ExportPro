import{a as E,r as k,s}from"./auth-BknLIeSq.js";/* empty css              */let l=[],w=[];document.addEventListener("DOMContentLoaded",async()=>{await E()&&(await k("credit-notes"),await Promise.all([I(),g()]),B())});async function I(){try{const{data:e,error:t}=await s.from("customers").select("id, company_name, country").order("company_name",{ascending:!0});if(t)throw t;w=e;const r=document.getElementById("cn-customer-select");r.innerHTML='<option value="">-- Müşteri Seçiniz --</option>',e.forEach(n=>{const a=document.createElement("option");a.value=n.id,a.textContent=`${n.company_name} (${n.country})`,r.appendChild(a)})}catch(e){console.error("Müşteri listesi ilişkisi kurulamadı:",e.message)}}async function g(){try{const{data:e,error:t}=await s.from("credit_notes").select(`
                *,
                customers ( company_name ),
                credit_note_items ( * )
            `).order("cn_date",{ascending:!1});if(t)throw t;l=e,x(e)}catch(e){console.error("Credit Note verileri yüklenemedi:",e.message),document.getElementById("cn-table-body").innerHTML='<tr><td colspan="5" class="text-center text-rose-400 py-4">Veriler yüklenirken hata oluştu.</td></tr>'}}function x(e){const t=document.getElementById("cn-table-body"),r=document.getElementById("total-cn-records");if(t.innerHTML="",r.textContent=`${e.length} Dosya`,e.length===0){t.innerHTML='<tr><td colspan="5" class="text-center text-slate-500 py-8">Kayıtlı Credit Note / Kalite şikayet dosyası bulunamadı.</td></tr>';return}e.forEach(n=>{const a=n.customers?n.customers.company_name:"Bilinmeyen Müşteri",i=n.credit_note_items&&n.credit_note_items.length>0?n.credit_note_items.map(m=>v(m.product_name)).join(", "):'<span class="text-slate-600 italic">Ürün kalemi girilmemiş</span>',c=document.createElement("tr");c.innerHTML=`
            <td class="text-slate-400 text-xs font-mono">${new Date(n.cn_date).toLocaleDateString("tr-TR")}</td>
            <td class="font-semibold text-slate-200">${v(a)}</td>
            <td class="text-slate-400 text-xs max-w-xs truncate">${i}</td>
            <td>
                <span class="px-2.5 py-1 rounded-md text-xs font-medium border ${M(n.process_status)}">
                    ${n.process_status||"İncelemede"}
                </span>
            </td>
            <td class="text-center">
                <button class="btn-edit-cn-trigger text-xs bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-slate-700 px-3 py-1.5 rounded-lg text-rose-400 transition-colors" data-id="${n.id}">
                    <i class="fa-solid fa-folder-open"></i> Dosyayı Aç
                </button>
            </td>
        `,t.appendChild(c)}),t.querySelectorAll(".btn-edit-cn-trigger").forEach(n=>{n.addEventListener("click",a=>{S(a.currentTarget.getAttribute("data-id"))})})}function B(){document.getElementById("btn-open-cn-modal").addEventListener("click",C),document.getElementById("btn-close-cn-modal").addEventListener("click",p),document.getElementById("btn-cn-cancel").addEventListener("click",p),document.getElementById("cn-form").addEventListener("submit",L),document.getElementById("btn-delete-cn").addEventListener("click",$),document.getElementById("cn-search-input").addEventListener("input",_),document.getElementById("filter-cn-status").addEventListener("change",_),document.getElementById("btn-add-item-row").addEventListener("click",()=>{u()}),document.getElementById("btn-export-cn").addEventListener("click",N)}function u(e={}){const t=document.getElementById("cn-items-container"),r="row-"+Math.random().toString(36).substring(2,9),n=document.createElement("div");n.id=r,n.className="cn-item-row bg-slate-950 p-4 border border-slate-800/80 rounded-xl space-y-4 relative pt-10 md:pt-4",n.innerHTML=`
        <button type="button" class="btn-remove-row absolute top-3 right-3 text-slate-500 hover:text-rose-400 transition-colors" title="Satırı Çıkar">
            <i class="fa-solid fa-trash-can text-sm"></i>
        </button>

        <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
                <label class="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Ürün Adı *</label>
                <input type="text" class="item-product-name w-full text-xs" required placeholder="Örn: X Profili" value="${e.product_name||""}">
            </div>
            <div>
                <label class="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Ürün Kodu</label>
                <input type="text" class="item-product-code w-full text-xs" placeholder="Örn: ALM-202" value="${e.product_code||""}">
            </div>
            <div>
                <label class="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Şikayet (Complaint) ID</label>
                <input type="text" class="item-complaint-id w-full text-xs" placeholder="Örn: COMP-881" value="${e.complaint_id||""}">
            </div>
            <div>
                <label class="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Karar / Sonuç</label>
                <input type="text" class="item-decision w-full text-xs" placeholder="Örn: Yenisi Üretilecek" value="${e.decision||""}">
            </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-slate-900/60 pt-3">
            <div>
                <label class="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">İlişkili Hedef Sipariş / Fatura</label>
                <input type="text" class="item-target-order w-full text-xs" placeholder="Örn: Order #4512" value="${e.target_order||""}">
            </div>
            <div>
                <label class="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Hata/Problem Tanımı</label>
                <input type="text" class="item-desc-1 w-full text-xs" placeholder="Örn: Yüzeyde çizik ve deformasyon" value="${e.description_1||""}">
            </div>
            <div>
                <label class="block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">Kök Neden / Aksiyon Notu</label>
                <input type="text" class="item-desc-2 w-full text-xs" placeholder="Örn: Paketleme hattındaki rulo değişti" value="${e.description_2||""}">
            </div>
        </div>
    `,n.querySelector(".btn-remove-row").addEventListener("click",()=>{t.querySelectorAll(".cn-item-row").length>1?n.remove():alert("Bir Credit Note dosyasında en az bir ürün detayı bulunmalıdır.")}),t.appendChild(n)}function C(){document.getElementById("cn-form").reset(),document.getElementById("cn-id").value="",document.getElementById("cn_date").value=new Date().toISOString().slice(0,10),document.getElementById("cn-items-container").innerHTML="",u(),document.getElementById("cn-modal-title").innerHTML='<i class="fa-solid fa-file-medical text-rose-500"></i> Yeni Credit Note Dosyası Aç',document.getElementById("btn-delete-cn").classList.add("hidden"),document.getElementById("cn-modal").classList.remove("hidden")}function S(e){const t=l.find(n=>n.id===e);if(!t)return;document.getElementById("cn-id").value=t.id,document.getElementById("cn-customer-select").value=t.customer_id,document.getElementById("cn_date").value=t.cn_date,document.getElementById("process_status").value=t.process_status||"İncelemede";const r=document.getElementById("cn-items-container");r.innerHTML="",t.credit_note_items&&t.credit_note_items.length>0?t.credit_note_items.forEach(n=>{u(n)}):u(),document.getElementById("cn-modal-title").innerHTML='<i class="fa-solid fa-folder-open text-amber-500"></i> Dosya ve Kalite Süreç Yönetimi',document.getElementById("btn-delete-cn").classList.remove("hidden"),document.getElementById("cn-modal").classList.remove("hidden")}function p(){document.getElementById("cn-modal").classList.add("hidden")}async function L(e){e.preventDefault();const t=document.getElementById("cn-id").value,r=document.getElementById("cn-customer-select").value,n=document.getElementById("cn_date").value,a=document.getElementById("process_status").value;try{const{data:{session:i}}=await s.auth.getSession(),c=i.user.id;let m=t;const y={customer_id:r,cn_date:n,process_status:a};if(t){const{error:o}=await s.from("credit_notes").update(y).eq("id",t).eq("user_id",c);if(o)throw o;const{error:d}=await s.from("credit_note_items").delete().eq("credit_note_id",t);if(d)throw d}else{y.user_id=c;const{data:o,error:d}=await s.from("credit_notes").insert([y]).select().single();if(d)throw d;m=o.id}const h=document.querySelectorAll(".cn-item-row"),b=[];h.forEach(o=>{b.push({credit_note_id:m,product_name:o.querySelector(".item-product-name").value.trim(),product_code:o.querySelector(".item-product-code").value.trim()||null,complaint_id:o.querySelector(".item-complaint-id").value.trim()||null,decision:o.querySelector(".item-decision").value.trim()||null,target_order:o.querySelector(".item-target-order").value.trim()||null,description_1:o.querySelector(".item-desc-1").value.trim()||null,description_2:o.querySelector(".item-desc-2").value.trim()||null})});const{error:f}=await s.from("credit_note_items").insert(b);if(f)throw f;p(),await g()}catch(i){console.error("Master-Detail kayıt hatası:",i.message),alert("Dosya kaydedilirken hata meydana geldi: "+i.message)}}async function $(){const e=document.getElementById("cn-id").value;if(!(!e||!confirm("Bu Credit Note dosyasını sildiğinizde altındaki tüm ürün şikayet detayları da kalıcı olarak silinecektir! Emin misiniz?")))try{const{data:{session:t}}=await s.auth.getSession(),{error:r}=await s.from("credit_notes").delete().eq("id",e).eq("user_id",t.user.id);if(r)throw r;p(),await g()}catch(t){console.error(t.message)}}function M(e){switch(e){case"Onaylandı":return"bg-emerald-950/40 text-emerald-400 border-emerald-900/50";case"Mahsup Edildi":return"bg-blue-950/40 text-blue-400 border-blue-900/50";case"Reddedildi":return"bg-rose-950/40 text-rose-400 border-rose-900/50";default:return"bg-amber-950/40 text-amber-400 border-amber-900/50"}}function _(){const e=document.getElementById("cn-search-input").value.toLowerCase(),t=document.getElementById("filter-cn-status").value,r=l.filter(n=>{const i=(n.customers?n.customers.company_name.toLowerCase():"").includes(e),c=t===""||n.process_status===t;return i&&c});x(r)}function v(e){return e?e.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;"):""}function N(){if(l.length===0){alert("Dışa aktarılacak veri yok.");return}let e=`data:text/csv;charset=utf-8,\\uFEFFTarih;Musteri;Surec Durumu;Urun Adi;Urun Kodu;Complaint ID;Karar;Hedef Siparis;Hata Tanimi
`;l.forEach(r=>{const n=r.customers?r.customers.company_name:"Bilinmeyen Müşteri";r.credit_note_items&&r.credit_note_items.length>0?r.credit_note_items.forEach(a=>{e+=`"${r.cn_date}";"${n}";"${r.process_status}";"${a.product_name}";"${a.product_code||""}";"${a.complaint_id||""}";"${a.decision||""}";"${a.target_order||""}";"${a.description_1||""}"
`}):e+=`"${r.cn_date}";"${n}";"${r.process_status}";"";"";"";"";"";""
`});const t=document.createElement("a");t.setAttribute("href",encodeURI(e)),t.setAttribute("download",`Export_Credit_Notes_${new Date().toISOString().slice(0,10)}.csv`),document.body.appendChild(t),t.click(),document.body.removeChild(t)}
