(function(){const i=document.createElement("link").relList;if(i&&i.supports&&i.supports("modulepreload"))return;for(const e of document.querySelectorAll('link[rel="modulepreload"]'))l(e);new MutationObserver(e=>{for(const t of e)if(t.type==="childList")for(const a of t.addedNodes)a.tagName==="LINK"&&a.rel==="modulepreload"&&l(a)}).observe(document,{childList:!0,subtree:!0});function s(e){const t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),e.crossOrigin==="use-credentials"?t.credentials="include":e.crossOrigin==="anonymous"?t.credentials="omit":t.credentials="same-origin",t}function l(e){if(e.ep)return;e.ep=!0;const t=s(e);fetch(e.href,t)}})();const{createClient:y}=window.supabase;window._sb||(window._sb=y("https://rotquydzejivrhhkjkps.supabase.co","eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJvdHF1eWR6ZWppdnJoaGtqa3BzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2MjI4NzksImV4cCI6MjA5NTE5ODg3OX0.iSnCVTuIObT7G3hWfEyJ-kXEBumRbHSIV7QDN-WWWes",{auth:{persistSession:!0,autoRefreshToken:!0,storageKey:"sb-rotquydzejivrhhkjkps-auth-token",storage:window.localStorage}}));const h=window._sb,x="V: 1.0.38";async function v(d){var p,m;const{data:{session:i}}=await h.auth.getSession();if(!i&&!window.location.pathname.includes("login.html")){window.location.href="login.html";return}const s=document.getElementById("navbar-target");if(!s)return;const l=i&&i.user?i.user.email:"Giriş Yapılmadı",t=[{id:"dashboard",label:"Dashboard",icon:"fa-chart-pie",href:"index.html"},{id:"orders",label:"Siparişler",icon:"fa-boxes-stacked",href:"orders.html"},{id:"quotations",label:"Teklifler",icon:"fa-file-contract",href:"quotations.html"},{id:"customers",label:"Müşteriler",icon:"fa-users",href:"customers.html"},{id:"prices",label:"Fiyat Robotu",icon:"fa-calculator",href:"prices.html"},{id:"credit-notes",label:"Credit Notes",icon:"fa-file-invoice",href:"credit-notes.html"},{id:"products",label:"Ürün Kartları",icon:"fa-box",href:"products.html"},{id:"order-timeline",label:"Takip Takvimi",icon:"fa-calendar-check",href:"order-timeline.html"},{id:"profitability",label:"Karlılık Analizi",icon:"fa-chart-line",href:"profitability.html"},{id:"complaints",label:"Şikayet Panosu",icon:"fa-triangle-exclamation",href:"complaints.html"},{id:"payments",label:"Ödeme Takibi",icon:"fa-circle-dollar-to-slot",href:"payments.html"},{id:"shipments",label:"Sevkiyat",icon:"fa-ship",href:"shipments.html"},{id:"customer-score",label:"Müşteri Skoru",icon:"fa-ranking-star",href:"customer-score.html"},{id:"product-analysis",label:"Ürün Analizi",icon:"fa-boxes-stacked",href:"product-analysis.html"},{id:"market-analysis",label:"Pazar Analizi",icon:"fa-globe",href:"market-analysis.html"},{id:"help",label:"Yardım & Kılavuz",icon:"fa-circle-question",href:"help.html"}].map(r=>{const n=r.id===d,o=r.id==="help";return`${o?'<div style="height:1px;background:var(--sidebar-border,#EFEAE0);margin:6px 4px;"></div>':""}
            <a href="${r.href}"
               class="flex items-center gap-2.5 px-3 py-2 text-sm transition-all duration-150 ${n?"nav-active":""}"
               style="border-radius:6px;${o?"color:var(--ink-3,#968B7A);":""}">
                <i class="fa-solid ${r.icon}" style="width:14px;text-align:center;font-size:11px;"></i>
                ${r.label}
            </a>`}).join(""),a=`<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>`,f=localStorage.getItem("ep-theme")||"light",b=f==="dark"?"Açık Tema":"Koyu Tema",g=f==="dark"?"fa-sun":"fa-moon";s.innerHTML=`
        <aside id="main-sidebar" style="
            position:fixed; inset-block:0; left:0; width:230px;
            display:flex; flex-direction:column; justify-content:space-between;
            z-index:50;
            background: var(--sidebar-bg, #fff);
            border-right: 1px solid var(--sidebar-border, #EFEAE0);
            transition: background 0.25s, border-color 0.25s;
        ">
            <div style="padding:20px 14px 0;">
                <!-- Marka -->
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:28px;padding:0 4px;">
                    <div style="width:32px;height:32px;border-radius:7px;background:var(--ink-1,#1C1A17);display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background 0.25s;">
                        ${a}
                    </div>
                    <div>
                        <div style="font-family:Verdana, Geneva, sans-serif;font-size:20px;font-weight:500;color:var(--ink-1,#1C1A17);line-height:1.1;letter-spacing:-0.01em;transition:color 0.2s;">Export Suite</div>
                        <div style="font-size:10px;letter-spacing:0.18em;text-transform:uppercase;color:var(--ink-3,#968B7A);font-family:Verdana, Geneva, sans-serif;font-weight:500;transition:color 0.2s;">İhracat Yönetimi</div>
                    </div>
                </div>
                <!-- Nav -->
                <nav style="display:flex;flex-direction:column;gap:2px;">
                    ${t}
                </nav>
            </div>

            <!-- Alt kısım -->
            <div style="padding:14px;border-top:1px solid var(--sidebar-border,#EFEAE0);background:var(--surface-2,#FBF8F1);transition:background 0.25s,border-color 0.25s;">
                <div style="font-size:11px;color:var(--ink-2,#6B655B);margin-bottom:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:color 0.2s;">
                    <i class="fa-solid fa-user" style="font-size:9px;margin-right:4px;color:var(--ink-3,#968B7A);"></i>${l}
                </div>
                <div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:var(--ink-3,#968B7A);font-family:Verdana, Geneva, sans-serif;margin-bottom:10px;transition:color 0.2s;">${x}</div>

                <!-- Tema Toggle -->
                <button id="btn-theme-sidebar"
                    style="width:100%;height:32px;border-radius:6px;border:1px solid var(--border,#E4DDCE);background:var(--surface,#fff);color:var(--ink-2,#6B655B);font-size:11px;font-family:Verdana, Geneva, sans-serif;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;margin-bottom:6px;transition:background 0.15s,border-color 0.25s,color 0.2s;">
                    <i class="fa-solid ${g}" style="font-size:11px;"></i>
                    <span>${b}</span>
                </button>

                <!-- Çıkış -->
                <button id="btn-logout"
                    style="width:100%;height:32px;border-radius:6px;border:1px solid var(--border,#E4DDCE);background:transparent;color:var(--danger,#9F3D3D);font-size:11px;font-family:Verdana, Geneva, sans-serif;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;transition:background 0.15s,color 0.2s;">
                    <i class="fa-solid fa-right-from-bracket" style="font-size:11px;"></i>
                    Çıkış Yap
                </button>
            </div>
        </aside>
    `,(p=document.getElementById("btn-logout"))==null||p.addEventListener("click",async()=>{await h.auth.signOut(),window.location.href="login.html"}),(m=document.getElementById("btn-theme-sidebar"))==null||m.addEventListener("click",()=>{const n=(localStorage.getItem("ep-theme")||"light")==="dark"?"light":"dark";localStorage.setItem("ep-theme",n),document.documentElement.classList.remove("dark","light"),document.documentElement.classList.add(n);const o=document.getElementById("btn-theme-sidebar");if(o){const c=o.querySelector("i"),u=o.querySelector("span");n==="dark"?(c.className="fa-solid fa-sun",u.textContent="Açık Tema"):(c.className="fa-solid fa-moon",u.textContent="Koyu Tema")}})}export{v as r,h as s};
