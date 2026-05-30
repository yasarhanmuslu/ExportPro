import{r as C,s as _}from"./navbar-dnmEf3j7.js";import{r as D}from"./auth-BaxU_CVi.js";let u=[],f=[],l={},p=null;document.addEventListener("DOMContentLoaded",async()=>{var e,s,r;await D()&&(await C("profitability"),(e=document.getElementById("btn-refresh"))==null||e.addEventListener("click",async()=>{const n=document.querySelector("#btn-refresh i");n==null||n.classList.add("fa-spin"),await h(),n==null||n.classList.remove("fa-spin")}),(s=document.getElementById("modal-close-btn"))==null||s.addEventListener("click",v),(r=document.getElementById("customer-detail-modal"))==null||r.addEventListener("click",n=>{n.target===document.getElementById("customer-detail-modal")&&v()}),await h())});async function h(){try{await Promise.all([$(),k()]),w(),M(),A(),O(),L()}catch(t){console.error("Karlılık analizi yükleme hatası:",t.message)}}async function $(){const{data:t,error:e}=await _.from("customer_prices").select(`
            id, customer_id, product_name, list_price, discount_rate, net_price,
            customers!customer_prices_customer_id_fkey ( id, company_name, country )
        `).order("customer_id",{ascending:!0});if(e)throw e;u=t||[]}async function k(){const{data:t,error:e}=await _.from("orders").select("customer_id, total_amount, currency").order("customer_id",{ascending:!0});if(e)throw e;f=t||[]}function w(){l={},u.forEach(t=>{var s,r;const e=t.customer_id;e&&(l[e]||(l[e]={id:e,company_name:((s=t.customers)==null?void 0:s.company_name)||"Bilinmeyen",country:((r=t.customers)==null?void 0:r.country)||"",prices:[],totalOrders:0}),l[e].prices.push(t))}),f.forEach(t=>{const e=t.customer_id;e&&l[e]&&(l[e].totalOrders+=t.total_amount||0)})}function m(t,e){return t.length?t.reduce((s,r)=>s+(parseFloat(r[e])||0),0)/t.length:0}function I(t){return t.reduce((e,s)=>e+(s.total_amount||0),0)}function b(t,e,s){if(s===0)return 0;const r=s>0?e/s:0;return Math.round((100-t)*(.5+.5*r))}function x(t){return t>=1e6?(t/1e6).toFixed(2)+" M":t>=1e3?(t/1e3).toFixed(1)+" K":t.toFixed(2)}function z(t){return t>80?"score-green":t>=60?"score-yellow":"score-red"}function M(){const t=u.map(i=>parseFloat(i.discount_rate)||0),e=t.length?t.reduce((i,c)=>i+c,0)/t.length:0;let s="—",r=0;Object.values(l).forEach(i=>{const c=m(i.prices,"discount_rate");c>r&&(r=c,s=i.company_name)});const n=I(f),o=new Set(f.map(i=>i.customer_id).filter(Boolean)).size;document.getElementById("kpi-avg-discount").textContent=e.toFixed(1)+" %",document.getElementById("kpi-avg-discount-sub").textContent=`${u.length} fiyat kaydı üzerinden`,document.getElementById("kpi-max-discount-customer").textContent=s,document.getElementById("kpi-max-discount-rate").textContent=r>0?`% ${r.toFixed(1)} ortalama iskonto`:"—",document.getElementById("kpi-max-discount-rate").style.color="#9F3D3D",document.getElementById("kpi-total-sales").textContent=x(n),document.getElementById("kpi-active-customers").textContent=o}function A(){const t=document.getElementById("customer-discount-tbody"),e=document.getElementById("customer-table-count"),s=Object.values(l);if(!s.length){t.innerHTML='<tr><td colspan="7" style="text-align:center;padding:32px;color:#968B7A;">Fiyat kaydı bulunamadı.</td></tr>',e.textContent="0 müşteri";return}const r=Math.max(...s.map(a=>a.totalOrders),1),n=s.map(a=>{const o=m(a.prices,"discount_rate"),i=m(a.prices,"list_price"),c=m(a.prices,"net_price"),d=b(o,a.totalOrders,r);return{...a,avgDisc:o,avgList:i,avgNet:c,score:d}}).sort((a,o)=>o.score-a.score);e.textContent=`${n.length} müşteri`,t.innerHTML=n.map(a=>`
        <tr onclick="window.openCustomerModal('${a.id}')" title="Detay için tıklayın">
            <td>
                <div style="font-weight:500;color:#1C1A17;">${g(a.company_name)}</div>
                ${a.country?`<div style="font-size:11px;color:#968B7A;">${g(a.country)}</div>`:""}
            </td>
            <td style="text-align:right;font-family:monospace;font-size:12px;">${a.prices.length}</td>
            <td style="text-align:right;font-family:monospace;font-size:12px;">${a.avgList.toFixed(2)}</td>
            <td style="text-align:right;">
                <span style="font-weight:600;color:${a.avgDisc>20?"#9F3D3D":a.avgDisc>10?"#B26B33":"#3D6E50"};">
                    % ${a.avgDisc.toFixed(1)}
                </span>
            </td>
            <td style="text-align:right;font-family:monospace;font-size:12px;">${a.avgNet.toFixed(2)}</td>
            <td style="text-align:right;font-weight:500;color:#2D4A3E;">${x(a.totalOrders)}</td>
            <td style="text-align:center;">
                <span class="score-badge ${z(a.score)}">${a.score}</span>
            </td>
        </tr>
    `).join("")}function O(){var r;const t=Object.values(l).map(n=>({name:n.company_name.length>14?n.company_name.substring(0,12)+"…":n.company_name,avgDisc:m(n.prices,"discount_rate")})).filter(n=>n.avgDisc>0).sort((n,a)=>a.avgDisc-n.avgDisc);if(!t.length)return;const e=(r=document.getElementById("chart-discount-distribution"))==null?void 0:r.getContext("2d");if(!e)return;p&&(p.destroy(),p=null);const s=t.map(n=>n.avgDisc>20?"rgba(159,61,61,0.75)":n.avgDisc>10?"rgba(178,107,51,0.75)":"rgba(61,110,80,0.75)");p=new Chart(e,{type:"bar",data:{labels:t.map(n=>n.name),datasets:[{label:"Ort. İskonto %",data:t.map(n=>parseFloat(n.avgDisc.toFixed(1))),backgroundColor:s,borderColor:s.map(n=>n.replace("0.75","1")),borderWidth:1,borderRadius:4}]},options:{responsive:!0,maintainAspectRatio:!1,plugins:{legend:{display:!1},tooltip:{backgroundColor:"#1C1A17",titleFont:{family:"Verdana",size:11},bodyFont:{family:"Verdana",size:12},padding:10,callbacks:{label:n=>` % ${n.raw} iskonto`}}},scales:{x:{grid:{display:!1},ticks:{font:{family:"Verdana",size:10},color:"#968B7A",maxRotation:35,minRotation:20}},y:{beginAtZero:!0,grid:{color:"#F4F0E8"},ticks:{font:{family:"Verdana",size:10},color:"#968B7A",callback:n=>`%${n}`}}}}})}function L(){const t=document.getElementById("product-price-list"),e=document.getElementById("product-inconsistency-count"),s={};u.forEach(o=>{var c;const i=((c=o.product_name)==null?void 0:c.trim())||"Bilinmeyen";s[i]||(s[i]=[]),s[i].push(parseFloat(o.net_price)||0)});const r=Object.entries(s).filter(([,o])=>o.length>=2).map(([o,i])=>{const c=Math.min(...i),d=Math.max(...i),y=i.reduce((F,E)=>F+E,0)/i.length,B=d>0?(d-c)/d*100:0;return{name:o,min:c,max:d,avg:y,spread:B,count:i.length}}).sort((o,i)=>i.spread-o.spread),n=r.filter(o=>o.spread>15).length;if(n>0&&(e.textContent=`${n} tutarsız ürün`,e.style.display="inline-flex"),!r.length){t.innerHTML=`<div style="text-align:center;padding:24px;color:#968B7A;font-size:12px;">
            Karşılaştırılacak yeterli fiyat kaydı yok (en az 2 müşteri gerekli).
        </div>`;return}const a=Math.max(...r.map(o=>o.max),1);t.innerHTML=r.map(o=>{const i=o.spread>15,c=(o.min/a*100).toFixed(1),d=((o.max-o.min)/a*100).toFixed(1),y=o.name.length>26?o.name.substring(0,24)+"…":o.name;return`
        <div class="product-price-row">
            <div style="flex:0 0 160px;min-width:0;">
                <div style="font-size:12px;font-weight:500;color:#1C1A17;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${g(o.name)}">${g(y)}</div>
                <div style="font-size:10px;color:#968B7A;margin-top:1px;">${o.count} müşteri</div>
            </div>
            <div class="price-range-bar">
                <div class="price-range-fill" style="left:${c}%;width:${Math.max(parseFloat(d),1)}%;"></div>
            </div>
            <div style="flex:0 0 auto;text-align:right;min-width:120px;">
                <div style="font-size:11px;font-family:monospace;color:#6B655B;">
                    <span style="color:#3D6E50;">${o.min.toFixed(2)}</span>
                    <span style="color:#968B7A;margin:0 3px;">—</span>
                    <span style="color:#9F3D3D;">${o.max.toFixed(2)}</span>
                </div>
                <div style="font-size:10px;color:#968B7A;">ort: ${o.avg.toFixed(2)}</div>
            </div>
            <span class="tag-badge ${i?"tag-inconsistent":"tag-consistent"}" style="flex-shrink:0;">
                ${i?`<i class="fa-solid fa-triangle-exclamation" style="font-size:9px;"></i> % ${o.spread.toFixed(0)} fark`:'<i class="fa-solid fa-check" style="font-size:9px;"></i> tutarlı'}
            </span>
        </div>`}).join("")}window.openCustomerModal=function(t){const e=l[t];if(!e)return;const s=m(e.prices,"discount_rate"),r=Math.max(...Object.values(l).map(i=>i.totalOrders),1),n=b(s,e.totalOrders,r);document.getElementById("modal-customer-name").textContent=e.company_name,document.getElementById("modal-avg-discount").textContent=`% ${s.toFixed(1)}`,document.getElementById("modal-total-orders").textContent=x(e.totalOrders);const a=document.getElementById("modal-score");a.textContent=n,a.style.color=n>80?"#3D6E50":n>=60?"#B26B33":"#9F3D3D";const o=document.getElementById("modal-products-tbody");if(!e.prices.length)o.innerHTML='<tr><td colspan="4" style="text-align:center;padding:20px;color:#968B7A;">Fiyat kaydı bulunamadı.</td></tr>';else{const i=[...e.prices].sort((c,d)=>(c.product_name||"").localeCompare(d.product_name||"","tr"));o.innerHTML=i.map(c=>`
            <tr>
                <td style="font-weight:500;">${g(c.product_name||"—")}</td>
                <td style="text-align:right;font-family:monospace;font-size:12px;">${parseFloat(c.list_price||0).toFixed(2)}</td>
                <td style="text-align:right;">
                    <span style="font-weight:600;color:${parseFloat(c.discount_rate)>20?"#9F3D3D":parseFloat(c.discount_rate)>10?"#B26B33":"#3D6E50"};">
                        % ${parseFloat(c.discount_rate||0).toFixed(1)}
                    </span>
                </td>
                <td style="text-align:right;font-family:monospace;font-size:12px;font-weight:600;color:#2D4A3E;">
                    ${parseFloat(c.net_price||0).toFixed(2)}
                </td>
            </tr>
        `).join("")}document.getElementById("customer-detail-modal").classList.add("active")};function v(){var t;(t=document.getElementById("customer-detail-modal"))==null||t.classList.remove("active")}function g(t){return String(t).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}
