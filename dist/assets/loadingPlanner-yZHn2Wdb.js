import{s as C,r as oe}from"./navbar-dnmEf3j7.js";const j=[{id:"std",name:"Standart / Optima Tenteli Tır",L:1360,W:245,H:270},{id:"mega",name:"Mega Tenteli Tır",L:1360,W:245,H:300},{id:"40hq",name:"40' HQ Konteyner",L:1203,W:235,H:269},{id:"20dc",name:"20' DC Konteyner",L:590,W:235,H:239}],W=["#2D4A3E","#B58858","#3F5C7A","#9F3D3D","#5A6E3A","#7A4F3F","#3D5A6E","#6B4E7A","#4E7A5A","#7A6B3D"];let I="std",Y="3d",_=[],G=null;window.rows=[];let re=0,$=[],P=null,R=null;document.addEventListener("DOMContentLoaded",async()=>{const{data:{session:e}}=await C.auth.getSession();if(!e){window.location.href="login.html";return}R=e,await oe("loading-planner"),ce(),Z(),O(120,80,150,1,!0,""),await se()});async function se(){try{const{data:e,error:t}=await C.from("saved_pallets").select("*").eq("user_id",R.user.id).order("created_at",{ascending:!0});if(t)throw t;$=e||[]}catch(e){console.error("Kayıtlı paletler yüklenemedi:",e)}}async function le(e,t,o,d,p){try{const{data:a,error:g}=await C.from("saved_pallets").insert([{user_id:R.user.id,name:e,l:t,g:o,y:d,stackable:p}]).select().single();if(g)throw g;$.push(a),ae(`"${e}" kaydedildi`)}catch(a){console.error("Kaydetme hatası:",a),alert("Kaydetme sırasında hata oluştu.")}}async function de(e){try{const{error:t}=await C.from("saved_pallets").delete().eq("id",e).eq("user_id",R.user.id);if(t)throw t;$=$.filter(o=>o.id!==e),te(),ae("Kayıt silindi")}catch(t){console.error("Silme hatası:",t),alert("Silme sırasında hata oluştu.")}}function ce(){document.getElementById("planner-root").innerHTML=`

    <!-- Araç Seçimi -->
    <div class="section-card" style="margin-bottom:20px;">
      <div class="section-title" style="margin-bottom:14px;">
        <i class="fa-solid fa-truck"></i> Araç / Konteyner Seçimi
      </div>
      <div id="vgrid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;"></div>
    </div>

    <!-- Palet Listesi -->
    <div class="section-card" style="margin-bottom:20px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
        <div class="section-title"><i class="fa-solid fa-pallet"></i> Palet Listesi</div>
        <button onclick="openLibrary()" style="
          display:inline-flex;align-items:center;gap:6px;
          padding:6px 14px;border-radius:6px;font-size:11px;font-weight:600;
          letter-spacing:0.06em;cursor:pointer;
          background:var(--surface-2);border:1px solid var(--border);color:var(--ink-2);
          font-family:Verdana,Geneva,sans-serif;">
          <i class="fa-solid fa-book"></i> Kayıtlı Paletler
        </button>
      </div>

      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead>
            <tr style="border-bottom:1px solid var(--border-soft);">
              <th style="width:16px;padding:6px;"></th>
              <th style="padding:6px 8px;text-align:left;font-size:10px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:var(--ink-3);">Palet Adı</th>
              <th style="padding:6px 8px;text-align:left;font-size:10px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:var(--ink-3);width:72px;">L (cm)</th>
              <th style="padding:6px 8px;text-align:left;font-size:10px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:var(--ink-3);width:72px;">G (cm)</th>
              <th style="padding:6px 8px;text-align:left;font-size:10px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:var(--ink-3);width:72px;">Y (cm)</th>
              <th style="padding:6px 8px;text-align:left;font-size:10px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:var(--ink-3);width:60px;">Adet</th>
              <th style="padding:6px 8px;text-align:center;font-size:10px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:var(--ink-3);width:90px;">İstiflenir</th>
              <th style="padding:6px 8px;text-align:right;font-size:10px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:var(--ink-3);width:68px;">m³</th>
              <th style="width:64px;"></th>
            </tr>
          </thead>
          <tbody id="ptbody"></tbody>
        </table>
      </div>

      <button onclick="addRow()" style="
        display:inline-flex;align-items:center;gap:6px;margin-top:12px;
        padding:6px 14px;border-radius:6px;font-size:11px;font-weight:600;
        letter-spacing:0.06em;cursor:pointer;
        background:var(--surface-2);border:1px solid var(--border);color:var(--ink-2);
        font-family:Verdana,Geneva,sans-serif;">
        <i class="fa-solid fa-plus"></i> Palet Ekle
      </button>
    </div>

    <!-- Toplam m³ Özeti -->
    <div class="section-card" style="margin-bottom:20px;">
      <div style="display:flex;align-items:stretch;gap:0;">
        <div style="flex:1;padding:4px 20px 4px 0;">
          <div style="font-size:10px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:var(--ink-3);margin-bottom:4px;">Toplam Hacim</div>
          <div style="display:flex;align-items:baseline;gap:6px;">
            <span id="totalM3" style="font-size:26px;font-weight:600;color:var(--accent);">0.00</span>
            <span style="font-size:13px;color:var(--ink-3);">m³</span>
          </div>
        </div>
        <div style="width:1px;background:var(--border-soft);"></div>
        <div style="flex:1;padding:4px 20px;">
          <div style="font-size:10px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:var(--ink-3);margin-bottom:4px;">Araç Kapasitesi</div>
          <div id="vehicleM3" style="font-size:18px;font-weight:600;color:var(--ink-1);">—</div>
        </div>
        <div style="width:1px;background:var(--border-soft);"></div>
        <div style="flex:1;padding:4px 0 4px 20px;">
          <div style="font-size:10px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:var(--ink-3);margin-bottom:4px;">Kalan</div>
          <div id="remainM3" style="font-size:18px;font-weight:600;">—</div>
        </div>
      </div>
    </div>

    <!-- Hesapla Butonu -->
    <button onclick="calculate()" style="
      width:100%;padding:12px;border-radius:8px;
      background:var(--accent);color:#fff;border:none;
      font-size:13px;font-weight:600;letter-spacing:0.06em;
      cursor:pointer;font-family:Verdana,Geneva,sans-serif;
      display:flex;align-items:center;justify-content:center;gap:8px;
      margin-bottom:24px;">
      <i class="fa-solid fa-calculator"></i> Hesapla & 3D Planla
    </button>

    <!-- Sonuçlar -->
    <div id="results" style="display:none;">

      <div id="noteBox" style="margin-bottom:16px;"></div>

      <!-- KPI Kartlar -->
      <div id="statsRow" style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px;"></div>

      <!-- Progress Barlar -->
      <div class="section-card" style="margin-bottom:20px;">
        <div id="progressRows"></div>
      </div>

      <!-- Görünüm -->
      <div class="section-card" style="margin-bottom:20px;">
        <div id="viewTabs" style="display:flex;gap:6px;margin-bottom:14px;"></div>
        <canvas id="viewCanvas" style="width:100%;display:block;border-radius:6px;"></canvas>
      </div>

      <!-- Legend -->
      <div id="legWrap" style="display:flex;flex-wrap:wrap;gap:6px 16px;font-size:11px;color:var(--ink-2);margin-bottom:24px;"></div>

    </div>

    <!-- Save Modal -->
    <div id="saveModalWrap" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;align-items:center;justify-content:center;">
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:28px;width:360px;max-width:94vw;">
        <div class="modal-title" style="margin-bottom:18px;">
          <i class="fa-solid fa-floppy-disk" style="color:var(--accent);"></i> Paleti Kaydet
        </div>
        <div style="font-size:10px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:var(--ink-3);margin-bottom:6px;">Kayıt Adı</div>
        <input type="text" id="saveNameInput" placeholder="Örn: Duvara Sıfır Klozet Paleti"
          style="width:100%;padding:9px 12px;border-radius:6px;border:1px solid var(--border);
          background:var(--surface-2);color:var(--ink-1);font-size:13px;
          font-family:Verdana,Geneva,sans-serif;outline:none;margin-bottom:8px;" />
        <div id="saveDimPreview" style="font-size:11px;color:var(--ink-3);margin-bottom:20px;"></div>
        <div style="display:flex;gap:8px;">
          <button onclick="closeSaveModal()" style="
            flex:1;padding:9px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;
            background:var(--surface-2);border:1px solid var(--border);color:var(--ink-2);
            font-family:Verdana,Geneva,sans-serif;">İptal</button>
          <button onclick="confirmSave()" style="
            flex:1;padding:9px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;
            background:var(--accent);border:none;color:#fff;
            font-family:Verdana,Geneva,sans-serif;">
            <i class="fa-solid fa-check"></i> Kaydet</button>
        </div>
      </div>
    </div>

    <!-- Library Modal -->
    <div id="libModalWrap" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;align-items:center;justify-content:center;">
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:28px;width:420px;max-width:94vw;">
        <div class="modal-title" style="margin-bottom:18px;">
          <i class="fa-solid fa-book" style="color:var(--accent);"></i> Kayıtlı Palet Kütüphanesi
        </div>
        <div id="savedList" style="max-height:300px;overflow-y:auto;margin-bottom:18px;"></div>
        <button onclick="closeLibrary()" style="
          width:100%;padding:9px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;
          background:var(--surface-2);border:1px solid var(--border);color:var(--ink-2);
          font-family:Verdana,Geneva,sans-serif;">Kapat</button>
      </div>
    </div>

    <!-- Toast -->
    <div id="ep-toast" style="
      display:none;position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
      background:var(--ink-1);color:var(--surface);font-size:12px;font-weight:600;
      padding:9px 20px;border-radius:20px;z-index:9999;
      font-family:Verdana,Geneva,sans-serif;pointer-events:none;"></div>
  `}function Z(){const e=document.getElementById("vgrid");e&&(e.innerHTML="",j.forEach(t=>{const o=q(t),d=t.id===I,p=document.createElement("div");p.style.cssText=`
      padding:14px 16px;border-radius:8px;cursor:pointer;
      border:1px solid ${d?"var(--accent)":"var(--border-soft)"};
      background:${d?"var(--accent-soft)":"var(--surface)"};
      transition:border-color .15s,background .15s;`,p.innerHTML=`
      <div style="font-size:12px;font-weight:600;color:${d?"var(--accent)":"var(--ink-1)"};">
        ${t.name}
      </div>
      <div style="font-size:11px;color:var(--ink-3);margin-top:3px;">
        ${(t.L/100).toFixed(2)}m × ${(t.W/100).toFixed(2)}m × ${(t.H/100).toFixed(2)}m &nbsp;·&nbsp; ${o} m³
      </div>`,p.onclick=()=>{I=t.id,Z(),X(),document.getElementById("results").style.display="none"},e.appendChild(p)}))}function q(e){return+(e.L/100*(e.W/100)*(e.H/100)).toFixed(2)}function O(e=120,t=80,o=150,d=1,p=!0,a=""){window.rows.push({id:re++,L:e,G:t,Y:o,qty:d,stackable:p,name:a}),V()}window.addRow=O;function pe(e){window.rows=window.rows.filter(t=>t.id!==e),V()}window.removeRow=pe;function V(){const e=document.getElementById("ptbody");e&&(e.innerHTML="",window.rows.forEach((t,o)=>{const d=W[o%W.length],p=document.createElement("tr");p.style.borderBottom="1px solid var(--border-soft)",p.innerHTML=`
      <td style="padding:6px;">
        <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${d};"></span>
      </td>
      <td style="padding:6px 8px;">
        <input type="text" value="${Q(t.name)}" placeholder="Palet ${o+1}"
          oninput="window.rows[${o}].name=this.value"
          style="width:100%;background:transparent;border:none;outline:none;
          color:var(--ink-1);font-size:12px;font-family:Verdana,Geneva,sans-serif;" />
      </td>
      <td style="padding:6px 8px;">
        <input type="number" value="${t.L}" min="1"
          oninput="window.rows[${o}].L=+this.value;updateRowM3(${o})"
          style="width:60px;background:transparent;border:none;outline:none;
          color:var(--ink-1);font-size:12px;font-family:Verdana,Geneva,sans-serif;" />
      </td>
      <td style="padding:6px 8px;">
        <input type="number" value="${t.G}" min="1"
          oninput="window.rows[${o}].G=+this.value;updateRowM3(${o})"
          style="width:60px;background:transparent;border:none;outline:none;
          color:var(--ink-1);font-size:12px;font-family:Verdana,Geneva,sans-serif;" />
      </td>
      <td style="padding:6px 8px;">
        <input type="number" value="${t.Y}" min="1"
          oninput="window.rows[${o}].Y=+this.value;updateRowM3(${o})"
          style="width:60px;background:transparent;border:none;outline:none;
          color:var(--ink-1);font-size:12px;font-family:Verdana,Geneva,sans-serif;" />
      </td>
      <td style="padding:6px 8px;">
        <input type="number" value="${t.qty}" min="0" max="9999"
          oninput="window.rows[${o}].qty=+this.value;updateRowM3(${o})"
          style="width:58px;background:transparent;border:none;outline:none;
          color:var(--ink-1);font-size:12px;font-family:Verdana,Geneva,sans-serif;" />
      </td>
      <td style="padding:6px 8px;text-align:center;">
        <label style="display:inline-flex;align-items:center;gap:5px;cursor:pointer;">
          <input type="checkbox" ${t.stackable?"checked":""}
            onchange="window.rows[${o}].stackable=this.checked;renderRows()"
            style="width:14px;height:14px;accent-color:var(--accent);cursor:pointer;" />
          <span style="font-size:11px;color:${t.stackable?"var(--accent)":"var(--ink-3)"};">
            ${t.stackable?"Evet":"Hayır"}
          </span>
        </label>
      </td>
      <td style="padding:6px 8px;text-align:right;font-weight:600;color:var(--accent);" id="m3r_${t.id}">
        ${N(t)}
      </td>
      <td style="padding:6px 8px;">
        <div style="display:flex;gap:4px;justify-content:flex-end;">
          <button onclick="openSaveModal(${o})" title="Kaydet"
            style="width:28px;height:28px;border-radius:5px;border:1px solid var(--border);
            background:var(--surface-2);color:var(--ink-2);cursor:pointer;font-size:11px;">
            <i class="fa-solid fa-floppy-disk"></i>
          </button>
          <button onclick="removeRow(${t.id})" title="Sil"
            style="width:28px;height:28px;border-radius:5px;border:1px solid var(--border);
            background:var(--surface-2);color:var(--danger);cursor:pointer;font-size:11px;">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </td>`,e.appendChild(p)}),X())}window.renderRows=V;function N(e){return+(e.L/100*(e.G/100)*(e.Y/100)*e.qty).toFixed(3)}function fe(e){const t=window.rows[e],o=document.getElementById("m3r_"+t.id);o&&(o.textContent=N(t)),X()}window.updateRowM3=fe;function X(){const e=window.rows.reduce((v,h)=>v+N(h),0),t=document.getElementById("totalM3");t&&(t.textContent=e.toFixed(2));const o=j.find(v=>v.id===I),d=q(o),p=document.getElementById("vehicleM3");p&&(p.textContent=d+" m³");const a=d-e,g=document.getElementById("remainM3");g&&(g.textContent=(a>=0?"+":"")+a.toFixed(2)+" m³",g.style.color=a<0?"var(--danger)":a<d*.1?"var(--warn)":"var(--ok)")}function xe(e){P=e;const t=rows[e];document.getElementById("saveNameInput").value=t.name||"",document.getElementById("saveDimPreview").textContent=`${t.L} × ${t.G} × ${t.Y} cm  ·  ${t.stackable?"İstiflenebilir":"İstiflenemez"}`,document.getElementById("saveModalWrap").style.display="flex",setTimeout(()=>document.getElementById("saveNameInput").focus(),50)}window.openSaveModal=xe;function J(){document.getElementById("saveModalWrap").style.display="none",P=null}window.closeSaveModal=J;async function ue(){if(P===null)return;const e=window.rows[P],t=document.getElementById("saveNameInput").value.trim()||`${e.L}×${e.G}×${e.Y}`;e.name=t,J(),V(),await le(t,e.L,e.G,e.Y,e.stackable)}window.confirmSave=ue;function ge(){te(),document.getElementById("libModalWrap").style.display="flex"}window.openLibrary=ge;function ee(){document.getElementById("libModalWrap").style.display="none"}window.closeLibrary=ee;function te(){const e=document.getElementById("savedList");if(e){if(!$.length){e.innerHTML=`<div style="text-align:center;padding:28px 0;color:var(--ink-3);font-size:12px;">
      <i class="fa-solid fa-box-open" style="font-size:28px;display:block;margin-bottom:10px;"></i>
      Henüz kayıtlı palet yok.<br>Palet satırındaki
      <i class="fa-solid fa-floppy-disk"></i> butonunu kullanın.
    </div>`;return}e.innerHTML=$.map((t,o)=>`
    <div style="
      display:flex;align-items:center;gap:10px;padding:10px 12px;
      border:1px solid var(--border-soft);border-radius:7px;margin-bottom:6px;
      background:var(--surface-2);cursor:pointer;transition:border-color .15s;"
      onmouseenter="this.style.borderColor='var(--accent)'"
      onmouseleave="this.style.borderColor='var(--border-soft)'"
      onclick="addFromLibrary('${t.id}')">
      <span style="display:inline-block;width:10px;height:10px;border-radius:2px;
        background:${W[o%W.length]};flex-shrink:0;"></span>
      <div style="flex:1;min-width:0;">
        <div style="font-size:12px;font-weight:600;color:var(--ink-1);">${Q(t.name)}</div>
        <div style="font-size:11px;color:var(--ink-3);">
          ${t.l} × ${t.g} × ${t.y} cm &nbsp;·&nbsp; ${t.stackable?"İstiflenebilir":"İstiflenemez"}
        </div>
      </div>
      <button onclick="event.stopPropagation();deletePalletFromDB('${t.id}')"
        style="width:28px;height:28px;border-radius:5px;border:1px solid var(--border);
        background:var(--surface);color:var(--danger);cursor:pointer;font-size:11px;flex-shrink:0;">
        <i class="fa-solid fa-trash"></i>
      </button>
    </div>`).join("")}}function ye(e){const t=$.find(o=>o.id===e);t&&(O(t.l,t.g,t.y,1,t.stackable,t.name),ee())}window.addFromLibrary=ye;window.deletePalletFromDB=de;function ve(){const e=j.find(n=>n.id===I),t=window.rows.filter(n=>n.qty>0&&n.L>0&&n.G>0&&n.Y>0);if(!t.length){alert("En az bir palet için bilgi giriniz.");return}const o=[];let d=0,p=0,a=0;const g=[];t.forEach(n=>{for(let r=0;r<n.qty;r++)g.push({...n})});function v(n,r,y,m){const k=Math.floor(y/n)*Math.floor(m/r);return Math.floor(y/r)*Math.floor(m/n)>k?{useL:r,useG:n}:{useL:n,useG:r}}const h={};t.forEach(n=>{h[n.id]=v(n.L,n.G,e.L,e.W)});for(const n of g){const r=h[n.id],y=r.useL,m=r.useG;y>e.L||m>e.W||n.Y>e.H||(d+y>e.L&&(d=0,p+=a,a=0),!(p+m>e.W)&&(o.push({x:d,y:p,z:0,l:y,w:m,h:n.Y,ci:t.findIndex(k=>k.id===n.id),stackable:n.stackable,name:n.name||"Palet",layer:1}),d+=y,a=Math.max(a,m)))}const f=g.filter(n=>n.stackable);let b=0;for(const n of o.filter(r=>r.stackable&&r.layer===1)){if(b>=f.length)break;const r=f[b],y=n.z+n.h;if(y+r.Y>e.H){b++;continue}o.push({x:n.x,y:n.y,z:y,l:n.l,w:n.w,h:r.Y,ci:t.findIndex(m=>m.id===r.id),stackable:!0,name:r.name,layer:2}),b++}const c=o.filter(n=>n.layer===1).length,s=o.filter(n=>n.layer===2).length,x=Math.max(0,g.length-c-s),L=o.reduce((n,r)=>n+r.l*r.w*r.h,0)/1e6,u=q(e),B=o.filter(n=>n.layer===1).reduce((n,r)=>n+r.l*r.w,0)/1e4,K=e.L/100*(e.W/100),E=Math.min(100,Math.round(L/u*100)),z=Math.min(100,Math.round(B/K*100));document.getElementById("progressRows").innerHTML=`
    <div style="display:flex;justify-content:space-between;margin-bottom:5px;">
      <span style="font-size:12px;color:var(--ink-2);">Hacim kullanımı</span>
      <span style="font-size:12px;font-weight:600;color:var(--ink-1);">${E}%</span>
    </div>
    <div style="height:7px;background:var(--border-soft);border-radius:4px;overflow:hidden;margin-bottom:14px;">
      <div style="height:100%;width:${E}%;background:${E>=90?"var(--danger)":E>=70?"var(--warn)":"var(--accent)"};border-radius:4px;transition:width .5s ease;"></div>
    </div>
    <div style="display:flex;justify-content:space-between;margin-bottom:5px;">
      <span style="font-size:12px;color:var(--ink-2);">Alan kullanımı</span>
      <span style="font-size:12px;font-weight:600;color:var(--ink-1);">${z}%</span>
    </div>
    <div style="height:7px;background:var(--border-soft);border-radius:4px;overflow:hidden;">
      <div style="height:100%;width:${z}%;background:${z>=90?"var(--danger)":z>=70?"var(--warn)":"var(--bronze)"};border-radius:4px;transition:width .5s ease;"></div>
    </div>`,document.getElementById("statsRow").innerHTML=[{val:c,lbl:"1. Kat",color:"var(--accent)"},{val:s,lbl:"2. Kat (İstif)",color:"var(--ok)"},{val:x>0?x:"—",lbl:x>0?"Sığmayan":"Hepsi Sığdı",color:x>0?"var(--danger)":"var(--ink-3)"},{val:L.toFixed(1)+" m³",lbl:"Kullanılan Hacim",color:"var(--info)"}].map(n=>`
    <div class="kpi-card" style="text-align:center;">
      <div style="font-size:22px;font-weight:600;color:${n.color};line-height:1;">${n.val}</div>
      <div style="font-size:10px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:var(--ink-3);margin-top:6px;">${n.lbl}</div>
    </div>`).join("");const w=document.getElementById("noteBox");x>0?(w.style.cssText="padding:10px 14px;border-radius:7px;font-size:12px;font-weight:600;background:var(--danger-soft);border:1px solid var(--danger);color:var(--danger);",w.innerHTML=`<i class="fa-solid fa-triangle-exclamation"></i>  ${x} palet araçta yer bulamadı — ek araç gerekiyor. İstiflenebilir ${s} adet 2. kata alındı.`):s>0?(w.style.cssText="padding:10px 14px;border-radius:7px;font-size:12px;font-weight:600;background:var(--ok-soft);border:1px solid var(--ok);color:var(--ok);",w.innerHTML=`<i class="fa-solid fa-layer-group"></i>  Tüm ${c} palet yüklendi. ${s} adet istiflenebilir palet 2. kata çıkarıldı.`):(w.style.cssText="padding:10px 14px;border-radius:7px;font-size:12px;font-weight:600;background:var(--warn-soft);border:1px solid var(--warn);color:var(--warn);",w.innerHTML=`<i class="fa-solid fa-info-circle"></i>  Tüm ${c} palet 1 katta yüklendi. Araçta kullanılmayan alan mevcut.`);const i=t.map((n,r)=>{const y=n.stackable?'<span style="font-size:10px;padding:2px 7px;border-radius:3px;background:var(--accent-soft);color:var(--accent);font-weight:600;">istiflenebilir</span>':'<span style="font-size:10px;padding:2px 7px;border-radius:3px;background:var(--surface-2);color:var(--ink-3);font-weight:600;">tek kat</span>';return`<span style="display:inline-flex;align-items:center;gap:5px;">
      <span style="width:10px;height:10px;border-radius:2px;background:#3D6E50;display:inline-block;"></span>
      ${Q(n.name||"Palet "+(r+1))} (${n.L}×${n.G}×${n.Y}) ${y}
    </span>`});s>0&&i.push(`<span style="display:inline-flex;align-items:center;gap:5px;">
      <span style="width:10px;height:10px;border-radius:2px;background:#C9A06A;display:inline-block;"></span>
      <span style="font-size:11px;color:var(--ink-2);">2. kat istif paletleri</span>
    </span>`),document.getElementById("legWrap").innerHTML=i.join("");const l={"3d":"3D Görünüm",top:"Üstten",front:"Önden",side:"Yandan"};document.getElementById("viewTabs").innerHTML=["3d","top","front","side"].map(n=>{const r=Y===n;return`<button onclick="switchView('${n}',this)" style="
      padding:5px 14px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;
      font-family:Verdana,Geneva,sans-serif;letter-spacing:0.04em;
      border:1px solid ${r?"var(--accent)":"var(--border)"};
      background:${r?"var(--accent)":"var(--surface-2)"};
      color:${r?"#fff":"var(--ink-2)"};">
      ${l[n]}
    </button>`}).join(""),_=o,G=e,ne(Y),document.getElementById("results").style.display="block"}window.calculate=ve;function me(e,t){Y=e,document.querySelectorAll("#viewTabs button").forEach(o=>{o.style.background="var(--surface-2)",o.style.borderColor="var(--border)",o.style.color="var(--ink-2)"}),t.style.background="var(--accent)",t.style.borderColor="var(--accent)",t.style.color="#fff",G&&ne(e)}window.switchView=me;function ne(e){e==="3d"?be():he(e)}function be(){const e=G,t=_,o=document.getElementById("viewCanvas"),d=o.parentElement.clientWidth||800,p=Math.max(380,Math.min(480,d*.38));o.width=d,o.height=p;const a=o.getContext("2d");a.fillStyle="#1C1A17",a.fillRect(0,0,d,p);const g=.866,v=.5,h=(e.L+e.W)*g,f=(e.L+e.W)*v+e.H,b=Math.min(d*.78/h,p*.78/f),c=h*b,s=f*b,x=(d-c)/2+e.W*g*b,L=(p-s)/2+e.W*v*b+e.H*b;function u(i,l,n){return{px:x+(i*g-l*g)*b,py:L+(i*v+l*v-n)*b}}function B(i,l,n,r,y,m,k,T,M,H,A){const S=[u(i+1.2,l+1.2,n),u(i+r-1.2,l+1.2,n),u(i+r-1.2,l+y-1.2,n),u(i+1.2,l+y-1.2,n),u(i+1.2,l+1.2,n+m-1.2),u(i+r-1.2,l+1.2,n+m-1.2),u(i+r-1.2,l+y-1.2,n+m-1.2),u(i+1.2,l+y-1.2,n+m-1.2)],D=(F,ie)=>{a.beginPath(),a.moveTo(S[F[0]].px,S[F[0]].py),F.slice(1).forEach(U=>a.lineTo(S[U].px,S[U].py)),a.closePath(),a.fillStyle=ie,a.fill(),a.strokeStyle=H,a.lineWidth=A,a.stroke()};a.globalAlpha=.95,D([0,1,2,3],k),D([1,5,6,2],T),D([0,4,5,1],M),a.globalAlpha=1}function K(i,l,n,r,y,m,k,T){const M=[u(i,l,n),u(i+r,l,n),u(i+r,l+y,n),u(i,l+y,n),u(i,l,n+m),u(i+r,l,n+m),u(i+r,l+y,n+m),u(i,l+y,n+m)];a.strokeStyle=k,a.lineWidth=T,[[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]].forEach(([H,A])=>{a.beginPath(),a.moveTo(M[H].px,M[H].py),a.lineTo(M[A].px,M[A].py),a.stroke()})}a.strokeStyle="rgba(120,100,70,0.2)",a.lineWidth=.5;for(let i=0;i<=e.L;i+=120){const l=u(i,0,0),n=u(i,e.W,0);a.beginPath(),a.moveTo(l.px,l.py),a.lineTo(n.px,n.py),a.stroke()}for(let i=0;i<=e.W;i+=100){const l=u(0,i,0),n=u(e.L,i,0);a.beginPath(),a.moveTo(l.px,l.py),a.lineTo(n.px,n.py),a.stroke()}K(0,0,0,e.L,e.W,e.H,"rgba(200,185,155,0.55)",1.5),[...t].sort((i,l)=>i.layer!==l.layer?i.layer-l.layer:l.x+l.y-(i.x+i.y)).forEach(i=>{i.layer===1?B(i.x,i.y,i.z,i.l,i.w,i.h,"#4A8060","#2D5040","#3A6850","rgba(0,0,0,0.5)",.6):B(i.x,i.y,i.z,i.l,i.w,i.h,"#D4AA72","#A07840","#BC9458","rgba(0,0,0,0.4)",.6)}),a.fillStyle="#968B7A",a.font="11px Verdana",a.textAlign="left",a.textBaseline="top",a.fillText(e.name+"  ·  "+(e.L/100).toFixed(2)+"m × "+(e.W/100).toFixed(2)+"m × "+(e.H/100).toFixed(2)+"m",12,12);const z=t.filter(i=>i.layer===1).length,w=t.filter(i=>i.layer===2).length;a.fillStyle="#5A8A72",a.fillText(z+" palet (1. kat)"+(w>0?"   +   "+w+" palet (2. kat)":""),12,27)}function he(e){const t=G,o=_,d=document.getElementById("viewCanvas"),p=d.parentElement.clientWidth||800,a=24;let g,v,h;e==="top"?(g=t.L,v=t.W,h=s=>({x:s.x,y:s.y,w:s.l,h:s.w,layer:s.layer})):e==="front"?(g=t.W,v=t.H,h=s=>({x:s.y,y:t.H-s.z-s.h,w:s.w,h:s.h,layer:s.layer})):(g=t.L,v=t.H,h=s=>({x:s.x,y:t.H-s.z-s.h,w:s.l,h:s.h,layer:s.layer}));const f=Math.min((p-a*2)/g,(320-a*2)/v),b=Math.round(v*f)+a*2+28;d.width=p,d.height=b;const c=d.getContext("2d");c.fillStyle="#1C1A17",c.fillRect(0,0,p,b),c.fillStyle="#2A2724",c.fillRect(a,a,g*f,v*f),c.strokeStyle="#3A3630",c.lineWidth=1.5,c.strokeRect(a,a,g*f,v*f),[...o].sort((s,x)=>s.layer-x.layer).forEach(s=>{const x=h(s),L=s.layer===2?"#C9A06A":"#3D6E50",u=s.layer===2?"rgba(255,220,150,.5)":"rgba(0,0,0,.4)";c.fillStyle=L,c.fillRect(a+x.x*f,a+x.y*f,x.w*f,x.h*f),c.strokeStyle=u,c.lineWidth=s.layer===2?1:.5,c.strokeRect(a+x.x*f,a+x.y*f,x.w*f,x.h*f),s.layer===2&&x.w*f>18&&x.h*f>12&&(c.fillStyle="rgba(255,255,255,.85)",c.font="bold 9px Verdana",c.textAlign="center",c.textBaseline="middle",c.fillText("2",a+x.x*f+x.w*f/2,a+x.y*f+x.h*f/2))}),c.fillStyle="#6B655B",c.font="11px Verdana",c.textAlign="left",c.textBaseline="top",c.fillText({top:"üstten görünüm (uzunluk × genişlik)",front:"önden görünüm (genişlik × yükseklik)",side:"yandan görünüm (uzunluk × yükseklik)"}[e],a,v*f+a+6)}function Q(e){return String(e).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}function ae(e){const t=document.getElementById("ep-toast");t&&(t.textContent=e,t.style.display="block",clearTimeout(t._timer),t._timer=setTimeout(()=>{t.style.display="none"},2500))}
