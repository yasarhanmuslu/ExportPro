(function(){const s=document.createElement("link").relList;if(s&&s.supports&&s.supports("modulepreload"))return;for(const e of document.querySelectorAll('link[rel="modulepreload"]'))a(e);new MutationObserver(e=>{for(const t of e)if(t.type==="childList")for(const i of t.addedNodes)i.tagName==="LINK"&&i.rel==="modulepreload"&&a(i)}).observe(document,{childList:!0,subtree:!0});function o(e){const t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),e.crossOrigin==="use-credentials"?t.credentials="include":e.crossOrigin==="anonymous"?t.credentials="omit":t.credentials="same-origin",t}function a(e){if(e.ep)return;e.ep=!0;const t=o(e);fetch(e.href,t)}})();const{createClient:d}=window.supabase;window._sb||(window._sb=d("https://rotquydzejivrhhkjkps.supabase.co","eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJvdHF1eWR6ZWppdnJoaGtqa3BzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2MjI4NzksImV4cCI6MjA5NTE5ODg3OX0.iSnCVTuIObT7G3hWfEyJ-kXEBumRbHSIV7QDN-WWWes",{auth:{persistSession:!0,autoRefreshToken:!0,storageKey:"sb-rotquydzejivrhhkjkps-auth-token",storage:window.localStorage}}));const l=window._sb,u="V: 1.0.20";async function p(r){var i;const{data:{session:s}}=await l.auth.getSession();if(!s&&!window.location.pathname.includes("login.html")){window.location.href="login.html";return}const o=document.getElementById("navbar-target");if(!o)return;const a=s&&s.user?s.user.email:"Giriş Yapılmadı",t=[{id:"dashboard",label:"Dashboard",icon:"fa-chart-pie",href:"index.html"},{id:"orders",label:"Siparişler",icon:"fa-boxes-stacked",href:"orders.html"},{id:"customers",label:"Müşteriler",icon:"fa-users",href:"customers.html"},{id:"prices",label:"Fiyat Robotu",icon:"fa-calculator",href:"prices.html"},{id:"credit-notes",label:"Credit Notes",icon:"fa-file-invoice",href:"credit-notes.html"},{id:"products",label:"Ürün Kartları",icon:"fa-box",href:"products.html"}].map(n=>{const c=n.id===r?"bg-indigo-600/20 text-indigo-400 border border-indigo-500/30":"text-slate-400 hover:bg-slate-800 hover:text-white border border-transparent";return`
            <a href="${n.href}" class="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${c}">
                <i class="fa-solid ${n.icon} w-4 text-center"></i>
                ${n.label}
            </a>`}).join("");o.innerHTML=`
        <aside class="fixed inset-y-0 left-0 w-64 bg-slate-900 border-r border-slate-800 flex flex-col justify-between z-50">
            <div class="p-5">
                <div class="flex items-center gap-3 px-2 mb-8">
                    <i class="fa-solid fa-earth-americas text-2xl text-orange-500"></i>
                    <span class="text-lg font-bold text-white tracking-wider">EXPORT PRO</span>
                </div>
                <nav class="space-y-1">
                    ${t}
                </nav>
            </div>
            <div class="p-4 border-t border-slate-800 bg-slate-950/50 flex items-center justify-between text-xs text-slate-400">
                <div class="flex flex-col gap-0.5 min-w-0">
                    <span class="truncate max-w-[140px]"><i class="fa-solid fa-user text-slate-500 mr-1"></i> ${a}</span>
                    <span class="text-slate-600 text-[10px] font-mono">${u}</span>
                </div>
                <button id="btn-logout" class="text-rose-400 hover:text-rose-300 transition-colors" title="Çıkış Yap">
                    <i class="fa-solid fa-right-from-bracket"></i>
                </button>
            </div>
        </aside>
    `,(i=document.getElementById("btn-logout"))==null||i.addEventListener("click",async()=>{await l.auth.signOut(),window.location.href="login.html"})}async function h(){const{data:{session:r}}=await l.auth.getSession();return r||(window.location.href="login.html",null)}export{h as a,p as r,l as s};
