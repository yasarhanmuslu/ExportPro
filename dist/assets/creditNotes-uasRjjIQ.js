import{r as h,s as i}from"./navbar-dnmEf3j7.js";import{r as B}from"./auth-BaxU_CVi.js";let l=[],k=[];document.addEventListener("DOMContentLoaded",async()=>{await B()&&(await h("credit-notes"),await Promise.all([w(),g()]),I())});async function w(){try{const{data:t,error:e}=await i.from("customers").select("id, company_name, country").order("company_name",{ascending:!0});if(e)throw e;k=t;const r=document.getElementById("cn-customer-select");r.innerHTML='<option value="">-- Müşteri Seçiniz --</option>',t.forEach(n=>{const a=document.createElement("option");a.value=n.id,a.textContent=`${n.company_name} (${n.country})`,r.appendChild(a)})}catch(t){console.error("Müşteri listesi ilişkisi kurulamadı:",t.message)}}async function g(){try{const{data:t,error:e}=await i.from("credit_notes").select(`
                *,
                customers!credit_notes_customer_id_fkey ( company_name ),
                credit_note_items ( * )
            `).order("cn_date",{ascending:!1});if(e)throw e;l=t,E(t)}catch(t){console.error("Credit Note verileri yüklenemedi:",t.message),document.getElementById("cn-table-body").innerHTML='<tr><td colspan="5" class="text-center text-[#9F3D3D] py-4">Veriler yüklenirken hata oluştu.</td></tr>'}}function E(t){const e=document.getElementById("cn-table-body"),r=document.getElementById("total-cn-records");if(e.innerHTML="",r.textContent=`${t.length} Dosya`,t.length===0){e.innerHTML='<tr><td colspan="5" class="text-center text-[#968B7A] py-8">Kayıtlı Credit Note / Kalite şikayet dosyası bulunamadı.</td></tr>';return}t.forEach(n=>{const a=n.customers?n.customers.company_name:"Bilinmeyen Müşteri",d=n.credit_note_items&&n.credit_note_items.length>0?n.credit_note_items.map(m=>v(m.product_name)).join(", "):'<span class="text-slate-600 italic">Ürün kalemi girilmemiş</span>',c=document.createElement("tr");c.innerHTML=`
            <td class="text-[#6B655B] text-xs font-mono">${new Date(n.cn_date).toLocaleDateString("tr-TR")}</td>
            <td class="font-semibold text-[#1C1A17]">${v(a)}</td>
            <td class="text-[#6B655B] text-xs max-w-xs truncate">${d}</td>
            <td>
                <span class="px-2.5 py-1 rounded-md text-xs font-medium border ${$(n.process_status)}">
                    ${n.process_status||"İncelemede"}
                </span>
            </td>
            <td class="text-center">
                <button class="btn-edit-cn-trigger text-xs bg-[#FBF8F1] hover:bg-[#FBF8F1] border border-[#EFEAE0] hover:border-[#E4DDCE] px-3 py-1.5 rounded-lg text-[#9F3D3D] transition-colors" data-id="${n.id}">
                    <i class="fa-solid fa-folder-open"></i> Dosyayı Aç
                </button>
            </td>
        `,e.appendChild(c)}),e.querySelectorAll(".btn-edit-cn-trigger").forEach(n=>{n.addEventListener("click",a=>{S(a.currentTarget.getAttribute("data-id"))})})}function I(){document.getElementById("btn-open-cn-modal").addEventListener("click",C),document.getElementById("btn-close-cn-modal").addEventListener("click",p),document.getElementById("btn-cn-cancel").addEventListener("click",p),document.getElementById("cn-form").addEventListener("submit",L),document.getElementById("btn-delete-cn").addEventListener("click",D),document.getElementById("cn-search-input").addEventListener("input",_),document.getElementById("filter-cn-status").addEventListener("change",_),document.getElementById("btn-add-item-row").addEventListener("click",()=>{u()}),document.getElementById("btn-export-cn").addEventListener("click",N)}function u(t={}){const e=document.getElementById("cn-items-container"),r="row-"+Math.random().toString(36).substring(2,9),n=document.createElement("div");n.id=r,n.className="cn-item-row bg-[#F6F3EC] p-4 border border-[#EFEAE0]/80 rounded-xl space-y-4 relative pt-10 md:pt-4",n.innerHTML=`
        <button type="button" class="btn-remove-row absolute top-3 right-3 text-[#968B7A] hover:text-[#9F3D3D] transition-colors" title="Satırı Çıkar">
            <i class="fa-solid fa-trash-can text-sm"></i>
        </button>

        <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
                <label class="block text-[10px] font-semibold text-[#968B7A] uppercase tracking-wider mb-1">Ürün Adı *</label>
                <input type="text" class="item-product-name w-full text-xs" required placeholder="Örn: X Profili" value="${t.product_name||""}">
            </div>
            <div>
                <label class="block text-[10px] font-semibold text-[#968B7A] uppercase tracking-wider mb-1">Ürün Kodu</label>
                <input type="text" class="item-product-code w-full text-xs" placeholder="Örn: ALM-202" value="${t.product_code||""}">
            </div>
            <div>
                <label class="block text-[10px] font-semibold text-[#968B7A] uppercase tracking-wider mb-1">Şikayet (Complaint) ID</label>
                <input type="text" class="item-complaint-id w-full text-xs" placeholder="Örn: COMP-881" value="${t.complaint_id||""}">
            </div>
            <div>
                <label class="block text-[10px] font-semibold text-[#968B7A] uppercase tracking-wider mb-1">Karar / Sonuç</label>
                <input type="text" class="item-decision w-full text-xs" placeholder="Örn: Yenisi Üretilecek" value="${t.decision||""}">
            </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-3 gap-4 border-t border-slate-900/60 pt-3">
            <div>
                <label class="block text-[10px] font-semibold text-[#968B7A] uppercase tracking-wider mb-1">İlişkili Hedef Sipariş / Fatura</label>
                <input type="text" class="item-target-order w-full text-xs" placeholder="Örn: Order #4512" value="${t.target_order||""}">
            </div>
            <div>
                <label class="block text-[10px] font-semibold text-[#968B7A] uppercase tracking-wider mb-1">Hata/Problem Tanımı</label>
                <input type="text" class="item-desc-1 w-full text-xs" placeholder="Örn: Yüzeyde çizik ve deformasyon" value="${t.description_1||""}">
            </div>
            <div>
                <label class="block text-[10px] font-semibold text-[#968B7A] uppercase tracking-wider mb-1">Kök Neden / Aksiyon Notu</label>
                <input type="text" class="item-desc-2 w-full text-xs" placeholder="Örn: Paketleme hattındaki rulo değişti" value="${t.description_2||""}">
            </div>
        </div>
    `,n.querySelector(".btn-remove-row").addEventListener("click",()=>{e.querySelectorAll(".cn-item-row").length>1?n.remove():alert("Bir Credit Note dosyasında en az bir ürün detayı bulunmalıdır.")}),e.appendChild(n)}function C(){document.getElementById("cn-form").reset(),document.getElementById("cn-id").value="",document.getElementById("cn_date").value=new Date().toISOString().slice(0,10),document.getElementById("cn-items-container").innerHTML="",u(),document.getElementById("cn-modal-title").innerHTML='<i class="fa-solid fa-file-medical text-rose-500"></i> Yeni Credit Note Dosyası Aç',document.getElementById("btn-delete-cn").classList.add("hidden"),document.getElementById("cn-modal").classList.remove("hidden")}function S(t){const e=l.find(n=>n.id===t);if(!e)return;document.getElementById("cn-id").value=e.id,document.getElementById("cn-customer-select").value=e.customer_id,document.getElementById("cn_date").value=e.cn_date,document.getElementById("process_status").value=e.process_status||"İncelemede";const r=document.getElementById("cn-items-container");r.innerHTML="",e.credit_note_items&&e.credit_note_items.length>0?e.credit_note_items.forEach(n=>{u(n)}):u(),document.getElementById("cn-modal-title").innerHTML='<i class="fa-solid fa-folder-open text-amber-500"></i> Dosya ve Kalite Süreç Yönetimi',document.getElementById("btn-delete-cn").classList.remove("hidden"),document.getElementById("cn-modal").classList.remove("hidden")}function p(){document.getElementById("cn-modal").classList.add("hidden")}async function L(t){t.preventDefault();const e=document.getElementById("cn-id").value,r=document.getElementById("cn-customer-select").value,n=document.getElementById("cn_date").value,a=document.getElementById("process_status").value;try{const{data:{session:d}}=await i.auth.getSession(),c=d.user.id;let m=e;const y={customer_id:r,cn_date:n,process_status:a};if(e){const{error:o}=await i.from("credit_notes").update(y).eq("id",e).eq("user_id",c);if(o)throw o;const{error:s}=await i.from("credit_note_items").delete().eq("credit_note_id",e);if(s)throw s}else{y.user_id=c;const{data:o,error:s}=await i.from("credit_notes").insert([y]).select().single();if(s)throw s;m=o.id}const x=document.querySelectorAll(".cn-item-row"),b=[];x.forEach(o=>{b.push({credit_note_id:m,product_name:o.querySelector(".item-product-name").value.trim(),product_code:o.querySelector(".item-product-code").value.trim()||null,complaint_id:o.querySelector(".item-complaint-id").value.trim()||null,decision:o.querySelector(".item-decision").value.trim()||null,target_order:o.querySelector(".item-target-order").value.trim()||null,description_1:o.querySelector(".item-desc-1").value.trim()||null,description_2:o.querySelector(".item-desc-2").value.trim()||null})});const{error:f}=await i.from("credit_note_items").insert(b);if(f)throw f;p(),await g()}catch(d){console.error("Master-Detail kayıt hatası:",d.message),alert("Dosya kaydedilirken hata meydana geldi: "+d.message)}}async function D(){const t=document.getElementById("cn-id").value;if(!(!t||!confirm("Bu Credit Note dosyasını sildiğinizde altındaki tüm ürün şikayet detayları da kalıcı olarak silinecektir! Emin misiniz?")))try{const{data:{session:e}}=await i.auth.getSession(),{error:r}=await i.from("credit_notes").delete().eq("id",t).eq("user_id",e.user.id);if(r)throw r;p(),await g()}catch(e){console.error(e.message),e.code==="23503"?alert(`Bu Credit Note silinemez!
Bağlı ürün detay kayıtları bulunmaktadır.`):alert("Silme işlemi başarısız oldu: "+e.message)}}function $(t){switch(t){case"Onaylandı":return"bg-emerald-950/40 text-[#3D6E50] border-emerald-900/50";case"Mahsup Edildi":return"bg-blue-950/40 text-blue-400 border-blue-900/50";case"Reddedildi":return"bg-rose-950/40 text-[#9F3D3D] border-rose-900/50";default:return"bg-amber-950/40 text-[#B26B33] border-amber-900/50"}}function _(){const t=document.getElementById("cn-search-input").value.toLowerCase(),e=document.getElementById("filter-cn-status").value,r=l.filter(n=>{const d=(n.customers?n.customers.company_name.toLowerCase():"").includes(t),c=e===""||n.process_status===e;return d&&c});E(r)}function v(t){return t?t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;"):""}function N(){if(l.length===0){alert("Dışa aktarılacak veri yok.");return}let t=`data:text/csv;charset=utf-8,\\uFEFFTarih;Musteri;Surec Durumu;Urun Adi;Urun Kodu;Complaint ID;Karar;Hedef Siparis;Hata Tanimi
`;l.forEach(r=>{const n=r.customers?r.customers.company_name:"Bilinmeyen Müşteri";r.credit_note_items&&r.credit_note_items.length>0?r.credit_note_items.forEach(a=>{t+=`"${r.cn_date}";"${n}";"${r.process_status}";"${a.product_name}";"${a.product_code||""}";"${a.complaint_id||""}";"${a.decision||""}";"${a.target_order||""}";"${a.description_1||""}"
`}):t+=`"${r.cn_date}";"${n}";"${r.process_status}";"";"";"";"";"";""
`});const e=document.createElement("a");e.setAttribute("href",encodeURI(t)),e.setAttribute("download",`Export_Credit_Notes_${new Date().toISOString().slice(0,10)}.csv`),document.body.appendChild(e),e.click(),document.body.removeChild(e)}
