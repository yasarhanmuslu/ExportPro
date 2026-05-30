import { supabase } from './utils/supabaseClient.js';
import { renderNavbar } from './components/navbar.js';

const VEHICLES = [
  { id: 'std',  name: 'Standart / Optima Tenteli Tır', L: 1360, W: 245, H: 270 },
  { id: 'mega', name: 'Mega Tenteli Tır',               L: 1360, W: 245, H: 300 },
  { id: '40hq', name: "40' HQ Konteyner",               L: 1203, W: 235, H: 269 },
  { id: '20dc', name: "20' DC Konteyner",               L:  590, W: 235, H: 239 },
];

const PAL_COLORS = [
  '#2D4A3E','#B58858','#3F5C7A','#9F3D3D',
  '#5A6E3A','#7A4F3F','#3D5A6E','#6B4E7A',
  '#4E7A5A','#7A6B3D'
];

let selV = 'std';
let curView = '3d';
let lastBoxes = [], lastV = null;
window.rows = [];
let ridx = 0;
let savedPallets = [];
let pendingSaveIdx = null;
let session = null;

document.addEventListener('DOMContentLoaded', async () => {
  const { data: { session: s } } = await supabase.auth.getSession();
  if (!s) { window.location.href = 'login.html'; return; }
  session = s;

  await renderNavbar('loading-planner');
  buildUI();
  buildVGrid();
  addRow(120, 80, 150, 1, true, '');
  await fetchSaved();
});

// ─── Supabase ────────────────────────────────────────────────
async function fetchSaved() {
  try {
    const { data, error } = await supabase
      .from('saved_pallets')
      .select('*')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: true });
    if (error) throw error;
    savedPallets = data || [];
  } catch (e) {
    console.error('Kayıtlı paletler yüklenemedi:', e);
  }
}

async function savePalletToDB(name, L, G, Y, stackable) {
  try {
    const { data, error } = await supabase
      .from('saved_pallets')
      .insert([{ user_id: session.user.id, name, l: L, g: G, y: Y, stackable }])
      .select()
      .single();
    if (error) throw error;
    savedPallets.push(data);
    showToast(`"${name}" kaydedildi`);
  } catch (e) {
    console.error('Kaydetme hatası:', e);
    alert('Kaydetme sırasında hata oluştu.');
  }
}

async function deletePalletFromDB(id) {
  try {
    const { error } = await supabase
      .from('saved_pallets')
      .delete()
      .eq('id', id)
      .eq('user_id', session.user.id);
    if (error) throw error;
    savedPallets = savedPallets.filter(p => p.id !== id);
    renderLibraryList();
    showToast('Kayıt silindi');
  } catch (e) {
    console.error('Silme hatası:', e);
    alert('Silme sırasında hata oluştu.');
  }
}

// ─── UI ──────────────────────────────────────────────────────
function buildUI() {
  document.getElementById('planner-root').innerHTML = `

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
  `;
}

// ─── Araç Grid ───────────────────────────────────────────────
function buildVGrid() {
  const g = document.getElementById('vgrid');
  if (!g) return;
  g.innerHTML = '';
  VEHICLES.forEach(v => {
    const m3 = vM3(v);
    const isActive = v.id === selV;
    const d = document.createElement('div');
    d.style.cssText = `
      padding:14px 16px;border-radius:8px;cursor:pointer;
      border:1px solid ${isActive ? 'var(--accent)' : 'var(--border-soft)'};
      background:${isActive ? 'var(--accent-soft)' : 'var(--surface)'};
      transition:border-color .15s,background .15s;`;
    d.innerHTML = `
      <div style="font-size:12px;font-weight:600;color:${isActive ? 'var(--accent)' : 'var(--ink-1)'};">
        ${v.name}
      </div>
      <div style="font-size:11px;color:var(--ink-3);margin-top:3px;">
        ${(v.L/100).toFixed(2)}m × ${(v.W/100).toFixed(2)}m × ${(v.H/100).toFixed(2)}m &nbsp;·&nbsp; ${m3} m³
      </div>`;
    d.onclick = () => {
      selV = v.id;
      buildVGrid();
      recalcTotals();
      document.getElementById('results').style.display = 'none';
    };
    g.appendChild(d);
  });
}

function vM3(v) { return +((v.L/100)*(v.W/100)*(v.H/100)).toFixed(2); }

// ─── Satır Yönetimi ──────────────────────────────────────────
function addRow(L=120, G=80, Y=150, qty=1, stackable=true, name='') {
  window.rows.push({ id: ridx++, L, G, Y, qty, stackable, name });
  renderRows();
}
window.addRow = addRow;

function removeRow(id) { window.rows = window.rows.filter(r => r.id !== id); renderRows(); }
window.removeRow = removeRow;

function renderRows() {
  const tb = document.getElementById('ptbody');
  if (!tb) return;
  tb.innerHTML = '';
  window.rows.forEach((r, i) => {
    const c = PAL_COLORS[i % PAL_COLORS.length];
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid var(--border-soft)';
    tr.innerHTML = `
      <td style="padding:6px;">
        <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${c};"></span>
      </td>
      <td style="padding:6px 8px;">
        <input type="text" value="${escHtml(r.name)}" placeholder="Palet ${i+1}"
          oninput="window.rows[${i}].name=this.value"
          style="width:100%;background:transparent;border:none;outline:none;
          color:var(--ink-1);font-size:12px;font-family:Verdana,Geneva,sans-serif;" />
      </td>
      <td style="padding:6px 8px;">
        <input type="number" value="${r.L}" min="1"
          oninput="window.rows[${i}].L=+this.value;updateRowM3(${i})"
          style="width:60px;background:transparent;border:none;outline:none;
          color:var(--ink-1);font-size:12px;font-family:Verdana,Geneva,sans-serif;" />
      </td>
      <td style="padding:6px 8px;">
        <input type="number" value="${r.G}" min="1"
          oninput="window.rows[${i}].G=+this.value;updateRowM3(${i})"
          style="width:60px;background:transparent;border:none;outline:none;
          color:var(--ink-1);font-size:12px;font-family:Verdana,Geneva,sans-serif;" />
      </td>
      <td style="padding:6px 8px;">
        <input type="number" value="${r.Y}" min="1"
          oninput="window.rows[${i}].Y=+this.value;updateRowM3(${i})"
          style="width:60px;background:transparent;border:none;outline:none;
          color:var(--ink-1);font-size:12px;font-family:Verdana,Geneva,sans-serif;" />
      </td>
      <td style="padding:6px 8px;">
        <input type="number" value="${r.qty}" min="0" max="9999"
          oninput="window.rows[${i}].qty=+this.value;updateRowM3(${i})"
          style="width:58px;background:transparent;border:none;outline:none;
          color:var(--ink-1);font-size:12px;font-family:Verdana,Geneva,sans-serif;" />
      </td>
      <td style="padding:6px 8px;text-align:center;">
        <label style="display:inline-flex;align-items:center;gap:5px;cursor:pointer;">
          <input type="checkbox" ${r.stackable ? 'checked' : ''}
            onchange="window.rows[${i}].stackable=this.checked;renderRows()"
            style="width:14px;height:14px;accent-color:var(--accent);cursor:pointer;" />
          <span style="font-size:11px;color:${r.stackable ? 'var(--accent)' : 'var(--ink-3)'};">
            ${r.stackable ? 'Evet' : 'Hayır'}
          </span>
        </label>
      </td>
      <td style="padding:6px 8px;text-align:right;font-weight:600;color:var(--accent);" id="m3r_${r.id}">
        ${rowM3(r)}
      </td>
      <td style="padding:6px 8px;">
        <div style="display:flex;gap:4px;justify-content:flex-end;">
          <button onclick="openSaveModal(${i})" title="Kaydet"
            style="width:28px;height:28px;border-radius:5px;border:1px solid var(--border);
            background:var(--surface-2);color:var(--ink-2);cursor:pointer;font-size:11px;">
            <i class="fa-solid fa-floppy-disk"></i>
          </button>
          <button onclick="removeRow(${r.id})" title="Sil"
            style="width:28px;height:28px;border-radius:5px;border:1px solid var(--border);
            background:var(--surface-2);color:var(--danger);cursor:pointer;font-size:11px;">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </td>`;
    tb.appendChild(tr);
  });
  recalcTotals();
}
window.renderRows = renderRows;

function rowM3(r) { return +((r.L/100)*(r.G/100)*(r.Y/100)*r.qty).toFixed(3); }

function updateRowM3(i) {
  const r = window.rows[i];
  const el = document.getElementById('m3r_' + r.id);
  if (el) el.textContent = rowM3(r);
  recalcTotals();
}
window.updateRowM3 = updateRowM3;

function recalcTotals() {
  const total = window.rows.reduce((s, r) => s + rowM3(r), 0);
  const t = document.getElementById('totalM3');
  if (t) t.textContent = total.toFixed(2);
  const v = VEHICLES.find(x => x.id === selV);
  const vm3 = vM3(v);
  const vm3El = document.getElementById('vehicleM3');
  if (vm3El) vm3El.textContent = vm3 + ' m³';
  const rem = vm3 - total;
  const remEl = document.getElementById('remainM3');
  if (remEl) {
    remEl.textContent = (rem >= 0 ? '+' : '') + rem.toFixed(2) + ' m³';
    remEl.style.color = rem < 0 ? 'var(--danger)' : rem < vm3 * 0.1 ? 'var(--warn)' : 'var(--ok)';
  }
}

// ─── Modal: Kaydet ───────────────────────────────────────────
function openSaveModal(rowIdx) {
  pendingSaveIdx = rowIdx;
  const r = rows[rowIdx];
  document.getElementById('saveNameInput').value = r.name || '';
  document.getElementById('saveDimPreview').textContent =
    `${r.L} × ${r.G} × ${r.Y} cm  ·  ${r.stackable ? 'İstiflenebilir' : 'İstiflenemez'}`;
  document.getElementById('saveModalWrap').style.display = 'flex';
  setTimeout(() => document.getElementById('saveNameInput').focus(), 50);
}
window.openSaveModal = openSaveModal;

function closeSaveModal() {
  document.getElementById('saveModalWrap').style.display = 'none';
  pendingSaveIdx = null;
}
window.closeSaveModal = closeSaveModal;

async function confirmSave() {
  if (pendingSaveIdx === null) return;
  const r = window.rows[pendingSaveIdx];
  const name = document.getElementById('saveNameInput').value.trim() || `${r.L}×${r.G}×${r.Y}`;
  r.name = name;
  closeSaveModal();
  renderRows();
  await savePalletToDB(name, r.L, r.G, r.Y, r.stackable);
}
window.confirmSave = confirmSave;

// ─── Modal: Kütüphane ────────────────────────────────────────
function openLibrary() {
  renderLibraryList();
  document.getElementById('libModalWrap').style.display = 'flex';
}
window.openLibrary = openLibrary;

function closeLibrary() {
  document.getElementById('libModalWrap').style.display = 'none';
}
window.closeLibrary = closeLibrary;

function renderLibraryList() {
  const el = document.getElementById('savedList');
  if (!el) return;
  if (!savedPallets.length) {
    el.innerHTML = `<div style="text-align:center;padding:28px 0;color:var(--ink-3);font-size:12px;">
      <i class="fa-solid fa-box-open" style="font-size:28px;display:block;margin-bottom:10px;"></i>
      Henüz kayıtlı palet yok.<br>Palet satırındaki
      <i class="fa-solid fa-floppy-disk"></i> butonunu kullanın.
    </div>`;
    return;
  }
  el.innerHTML = savedPallets.map((p, i) => `
    <div style="
      display:flex;align-items:center;gap:10px;padding:10px 12px;
      border:1px solid var(--border-soft);border-radius:7px;margin-bottom:6px;
      background:var(--surface-2);cursor:pointer;transition:border-color .15s;"
      onmouseenter="this.style.borderColor='var(--accent)'"
      onmouseleave="this.style.borderColor='var(--border-soft)'"
      onclick="addFromLibrary('${p.id}')">
      <span style="display:inline-block;width:10px;height:10px;border-radius:2px;
        background:${PAL_COLORS[i % PAL_COLORS.length]};flex-shrink:0;"></span>
      <div style="flex:1;min-width:0;">
        <div style="font-size:12px;font-weight:600;color:var(--ink-1);">${escHtml(p.name)}</div>
        <div style="font-size:11px;color:var(--ink-3);">
          ${p.l} × ${p.g} × ${p.y} cm &nbsp;·&nbsp; ${p.stackable ? 'İstiflenebilir' : 'İstiflenemez'}
        </div>
      </div>
      <button onclick="event.stopPropagation();deletePalletFromDB('${p.id}')"
        style="width:28px;height:28px;border-radius:5px;border:1px solid var(--border);
        background:var(--surface);color:var(--danger);cursor:pointer;font-size:11px;flex-shrink:0;">
        <i class="fa-solid fa-trash"></i>
      </button>
    </div>`).join('');
}

function addFromLibrary(id) {
  const p = savedPallets.find(x => x.id === id);
  if (!p) return;
  addRow(p.l, p.g, p.y, 1, p.stackable, p.name);
  closeLibrary();
}
window.addFromLibrary = addFromLibrary;
window.deletePalletFromDB = deletePalletFromDB;

// ─── Hesapla ─────────────────────────────────────────────────
function calculate() {
  const v = VEHICLES.find(x => x.id === selV);
  const activeRows = window.rows.filter(r => r.qty > 0 && r.L > 0 && r.G > 0 && r.Y > 0);
  if (!activeRows.length) { alert('En az bir palet için bilgi giriniz.'); return; }

  const placed = [];
  let curX = 0, curY = 0, rowMaxG = 0;
  const allItems = [];
  activeRows.forEach(r => { for (let n = 0; n < r.qty; n++) allItems.push({ ...r }); });

  // Her palet tipi icin en iyi rotasyonu onceden belirle
  function bestOrientation(pL, pG, vL, vW) {
    const normal  = Math.floor(vL/pL) * Math.floor(vW/pG);
    const rotated = Math.floor(vL/pG) * Math.floor(vW/pL);
    if (rotated > normal) return { useL: pG, useG: pL };
    return { useL: pL, useG: pG };
  }
  const rowOrient = {};
  activeRows.forEach(r => {
    rowOrient[r.id] = bestOrientation(r.L, r.G, v.L, v.W);
  });

  for (const item of allItems) {
    const ori = rowOrient[item.id];
    const pL = ori.useL, pG = ori.useG;
    if (pL > v.L || pG > v.W || item.Y > v.H) continue;
    if (curX + pL > v.L) { curX = 0; curY += rowMaxG; rowMaxG = 0; }
    if (curY + pG > v.W) continue;
    placed.push({
      x: curX, y: curY, z: 0,
      l: pL, w: pG, h: item.Y,
      ci: activeRows.findIndex(r => r.id === item.id),
      stackable: item.stackable,
      name: item.name || 'Palet',
      layer: 1
    });
    curX += pL;
    rowMaxG = Math.max(rowMaxG, pG);
  }

  const stackableItems = allItems.filter(it => it.stackable);
  let si = 0;
  for (const gp of placed.filter(p => p.stackable && p.layer === 1)) {
    if (si >= stackableItems.length) break;
    const item = stackableItems[si];
    const newZ = gp.z + gp.h;
    if (newZ + item.Y > v.H) { si++; continue; }
    placed.push({
      x: gp.x, y: gp.y, z: newZ,
      l: gp.l, w: gp.w, h: item.Y,
      ci: activeRows.findIndex(r => r.id === item.id),
      stackable: true, name: item.name, layer: 2
    });
    si++;
  }

  const layer1 = placed.filter(p => p.layer === 1).length;
  const layer2 = placed.filter(p => p.layer === 2).length;
  const excess = Math.max(0, allItems.length - layer1 - layer2);
  const usedVol = placed.reduce((s, b) => s + b.l * b.w * b.h, 0) / 1e6;
  const totalVol = vM3(v);
  const usedArea = placed.filter(p => p.layer === 1).reduce((s, b) => s + b.l * b.w, 0) / 1e4;
  const totalArea = (v.L / 100) * (v.W / 100);
  const vPct = Math.min(100, Math.round(usedVol / totalVol * 100));
  const aPct = Math.min(100, Math.round(usedArea / totalArea * 100));

  // Progress barlar
  document.getElementById('progressRows').innerHTML = `
    <div style="display:flex;justify-content:space-between;margin-bottom:5px;">
      <span style="font-size:12px;color:var(--ink-2);">Hacim kullanımı</span>
      <span style="font-size:12px;font-weight:600;color:var(--ink-1);">${vPct}%</span>
    </div>
    <div style="height:7px;background:var(--border-soft);border-radius:4px;overflow:hidden;margin-bottom:14px;">
      <div style="height:100%;width:${vPct}%;background:${vPct>=90?'var(--danger)':vPct>=70?'var(--warn)':'var(--accent)'};border-radius:4px;transition:width .5s ease;"></div>
    </div>
    <div style="display:flex;justify-content:space-between;margin-bottom:5px;">
      <span style="font-size:12px;color:var(--ink-2);">Alan kullanımı</span>
      <span style="font-size:12px;font-weight:600;color:var(--ink-1);">${aPct}%</span>
    </div>
    <div style="height:7px;background:var(--border-soft);border-radius:4px;overflow:hidden;">
      <div style="height:100%;width:${aPct}%;background:${aPct>=90?'var(--danger)':aPct>=70?'var(--warn)':'var(--bronze)'};border-radius:4px;transition:width .5s ease;"></div>
    </div>`;

  // KPI kartlar
  document.getElementById('statsRow').innerHTML = [
    { val: layer1,                         lbl: '1. Kat',          color: 'var(--accent)' },
    { val: layer2,                         lbl: '2. Kat (İstif)',  color: 'var(--ok)' },
    { val: excess > 0 ? excess : '—',      lbl: excess > 0 ? 'Sığmayan' : 'Hepsi Sığdı', color: excess > 0 ? 'var(--danger)' : 'var(--ink-3)' },
    { val: usedVol.toFixed(1) + ' m³',     lbl: 'Kullanılan Hacim', color: 'var(--info)' },
  ].map(s => `
    <div class="kpi-card" style="text-align:center;">
      <div style="font-size:22px;font-weight:600;color:${s.color};line-height:1;">${s.val}</div>
      <div style="font-size:10px;font-weight:600;letter-spacing:0.12em;text-transform:uppercase;color:var(--ink-3);margin-top:6px;">${s.lbl}</div>
    </div>`).join('');

  // Not kutusu
  const nb = document.getElementById('noteBox');
  if (excess > 0) {
    nb.style.cssText = 'padding:10px 14px;border-radius:7px;font-size:12px;font-weight:600;background:var(--danger-soft);border:1px solid var(--danger);color:var(--danger);';
    nb.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i>  ${excess} palet araçta yer bulamadı — ek araç gerekiyor. İstiflenebilir ${layer2} adet 2. kata alındı.`;
  } else if (layer2 > 0) {
    nb.style.cssText = 'padding:10px 14px;border-radius:7px;font-size:12px;font-weight:600;background:var(--ok-soft);border:1px solid var(--ok);color:var(--ok);';
    nb.innerHTML = `<i class="fa-solid fa-layer-group"></i>  Tüm ${layer1} palet yüklendi. ${layer2} adet istiflenebilir palet 2. kata çıkarıldı.`;
  } else {
    nb.style.cssText = 'padding:10px 14px;border-radius:7px;font-size:12px;font-weight:600;background:var(--warn-soft);border:1px solid var(--warn);color:var(--warn);';
    nb.innerHTML = `<i class="fa-solid fa-info-circle"></i>  Tüm ${layer1} palet 1 katta yüklendi. Araçta kullanılmayan alan mevcut.`;
  }

  // Legend
  // 3D renk göstergesi
  const legItems = activeRows.map((r, i) => {
    const badge = r.stackable
      ? `<span style="font-size:10px;padding:2px 7px;border-radius:3px;background:var(--accent-soft);color:var(--accent);font-weight:600;">istiflenebilir</span>`
      : `<span style="font-size:10px;padding:2px 7px;border-radius:3px;background:var(--surface-2);color:var(--ink-3);font-weight:600;">tek kat</span>`;
    return `<span style="display:inline-flex;align-items:center;gap:5px;">
      <span style="width:10px;height:10px;border-radius:2px;background:#3D6E50;display:inline-block;"></span>
      ${escHtml(r.name || 'Palet ' + (i+1))} (${r.L}×${r.G}×${r.Y}) ${badge}
    </span>`;
  });
  if (layer2 > 0) {
    legItems.push(`<span style="display:inline-flex;align-items:center;gap:5px;">
      <span style="width:10px;height:10px;border-radius:2px;background:#C9A06A;display:inline-block;"></span>
      <span style="font-size:11px;color:var(--ink-2);">2. kat istif paletleri</span>
    </span>`);
  }
  document.getElementById('legWrap').innerHTML = legItems.join('');

  // View tabs
  const viewLabels = {'3d':'3D Görünüm','top':'Üstten','front':'Önden','side':'Yandan'};
  document.getElementById('viewTabs').innerHTML = ['3d','top','front','side'].map(vt => {
    const isActive = curView === vt;
    return `<button onclick="switchView('${vt}',this)" style="
      padding:5px 14px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer;
      font-family:Verdana,Geneva,sans-serif;letter-spacing:0.04em;
      border:1px solid ${isActive ? 'var(--accent)' : 'var(--border)'};
      background:${isActive ? 'var(--accent)' : 'var(--surface-2)'};
      color:${isActive ? '#fff' : 'var(--ink-2)'};">
      ${viewLabels[vt]}
    </button>`;
  }).join('');

  lastBoxes = placed; lastV = v;
  renderView(curView);
  document.getElementById('results').style.display = 'block';
}
window.calculate = calculate;

function switchView(v, el) {
  curView = v;
  document.querySelectorAll('#viewTabs button').forEach(b => {
    b.style.background = 'var(--surface-2)';
    b.style.borderColor = 'var(--border)';
    b.style.color = 'var(--ink-2)';
  });
  el.style.background = 'var(--accent)';
  el.style.borderColor = 'var(--accent)';
  el.style.color = '#fff';
  if (lastV) renderView(v);
}
window.switchView = switchView;

function renderView(v) { if (v === '3d') draw3D(); else draw2D(v); }

// ─── 3D Render ───────────────────────────────────────────────
function adjustColor(hex, amt) {
  let r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
  r = Math.max(0,Math.min(255,r+amt)); g = Math.max(0,Math.min(255,g+amt)); b = Math.max(0,Math.min(255,b+amt));
  return '#' + [r,g,b].map(x => x.toString(16).padStart(2,'0')).join('');
}

function draw3D() {
  const v = lastV, boxes = lastBoxes;
  const canvas = document.getElementById('viewCanvas');
  const W = canvas.parentElement.clientWidth || 800;
  const H = Math.max(380, Math.min(480, W * 0.38));
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1C1A17'; ctx.fillRect(0, 0, W, H);

  // İzometrik projeksiyon
  const isoX = 0.866, isoY = 0.5;
  const visW = (v.L + v.W) * isoX;
  const visH = (v.L + v.W) * isoY + v.H;
  const sc = Math.min((W * 0.78) / visW, (H * 0.78) / visH);
  const totalProjW = visW * sc;
  const totalProjH = visH * sc;
  const ox = (W - totalProjW) / 2 + v.W * isoX * sc;
  const oy = (H - totalProjH) / 2 + v.W * isoY * sc + v.H * sc;

  function proj(x, y, z) {
    return {
      px: ox + (x * isoX - y * isoX) * sc,
      py: oy + ((x * isoY + y * isoY) - z) * sc
    };
  }

  function drawBox(x, y, z, l, w, h, topC, sideC, frontC, strokeC, lw) {
    const g = 1.2;
    const p = [
      proj(x+g,y+g,z),   proj(x+l-g,y+g,z),   proj(x+l-g,y+w-g,z), proj(x+g,y+w-g,z),
      proj(x+g,y+g,z+h-g), proj(x+l-g,y+g,z+h-g), proj(x+l-g,y+w-g,z+h-g), proj(x+g,y+w-g,z+h-g)
    ];
    const face = (idx, col) => {
      ctx.beginPath(); ctx.moveTo(p[idx[0]].px, p[idx[0]].py);
      idx.slice(1).forEach(i => ctx.lineTo(p[i].px, p[i].py));
      ctx.closePath();
      ctx.fillStyle = col; ctx.fill();
      ctx.strokeStyle = strokeC; ctx.lineWidth = lw; ctx.stroke();
    };
    ctx.globalAlpha = 0.95;
    face([0,1,2,3], topC);
    face([1,5,6,2], sideC);
    face([0,4,5,1], frontC);
    ctx.globalAlpha = 1;
  }

  function wireBox(x, y, z, l, w, h, col, lw) {
    const p = [
      proj(x,y,z),proj(x+l,y,z),proj(x+l,y+w,z),proj(x,y+w,z),
      proj(x,y,z+h),proj(x+l,y,z+h),proj(x+l,y+w,z+h),proj(x,y+w,z+h)
    ];
    ctx.strokeStyle = col; ctx.lineWidth = lw;
    [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]].forEach(([a,b]) => {
      ctx.beginPath(); ctx.moveTo(p[a].px,p[a].py); ctx.lineTo(p[b].px,p[b].py); ctx.stroke();
    });
  }

  // Zemin ızgara
  ctx.strokeStyle = 'rgba(120,100,70,0.2)'; ctx.lineWidth = 0.5;
  for (let gx = 0; gx <= v.L; gx += 120) {
    const a = proj(gx,0,0), b = proj(gx,v.W,0);
    ctx.beginPath(); ctx.moveTo(a.px,a.py); ctx.lineTo(b.px,b.py); ctx.stroke();
  }
  for (let gy = 0; gy <= v.W; gy += 100) {
    const a = proj(0,gy,0), b = proj(v.L,gy,0);
    ctx.beginPath(); ctx.moveTo(a.px,a.py); ctx.lineTo(b.px,b.py); ctx.stroke();
  }

  // Araç kasası
  wireBox(0, 0, 0, v.L, v.W, v.H, 'rgba(200,185,155,0.55)', 1.5);

  // Paletler
  const sorted = [...boxes].sort((a, b) => {
    if (a.layer !== b.layer) return a.layer - b.layer;
    return (b.x + b.y) - (a.x + a.y);
  });

  sorted.forEach(b => {
    if (b.layer === 1) {
      drawBox(b.x,b.y,b.z,b.l,b.w,b.h, '#4A8060','#2D5040','#3A6850', 'rgba(0,0,0,0.5)', 0.6);
    } else {
      drawBox(b.x,b.y,b.z,b.l,b.w,b.h, '#D4AA72','#A07840','#BC9458', 'rgba(0,0,0,0.4)', 0.6);
    }
  });

  ctx.fillStyle = '#968B7A'; ctx.font = '11px Verdana';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText(v.name + '  ·  ' + (v.L/100).toFixed(2)+'m × '+(v.W/100).toFixed(2)+'m × '+(v.H/100).toFixed(2)+'m', 12, 12);
  const l1=boxes.filter(b=>b.layer===1).length, l2=boxes.filter(b=>b.layer===2).length;
  ctx.fillStyle='#5A8A72';
  ctx.fillText(l1+' palet (1. kat)'+(l2>0?'   +   '+l2+' palet (2. kat)':''), 12, 27);
}


function draw2D(view) {
  const v = lastV, boxes = lastBoxes;
  const canvas = document.getElementById('viewCanvas');
  const CW = canvas.parentElement.clientWidth || 800, margin = 24;
  let vW, vH, getRect;
  if (view === 'top')   { vW = v.L; vH = v.W; getRect = b => ({ x: b.x, y: b.y,           w: b.l, h: b.w, layer: b.layer }); }
  else if (view === 'front') { vW = v.W; vH = v.H; getRect = b => ({ x: b.y, y: v.H-b.z-b.h,  w: b.w, h: b.h, layer: b.layer }); }
  else                  { vW = v.L; vH = v.H; getRect = b => ({ x: b.x, y: v.H-b.z-b.h,  w: b.l, h: b.h, layer: b.layer }); }
  const scale = Math.min((CW - margin * 2) / vW, (320 - margin * 2) / vH);
  const CH = Math.round(vH * scale) + margin * 2 + 28;
  canvas.width = CW; canvas.height = CH;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1C1A17'; ctx.fillRect(0, 0, CW, CH);
  ctx.fillStyle = '#2A2724'; ctx.fillRect(margin, margin, vW * scale, vH * scale);
  ctx.strokeStyle = '#3A3630'; ctx.lineWidth = 1.5; ctx.strokeRect(margin, margin, vW * scale, vH * scale);

  [...boxes].sort((a, b) => a.layer - b.layer).forEach(b => {
    const r = getRect(b);
    // 1. kat koyu yesil, 2. kat bronz - 2D'de de ayni renk sistemi
    const fillC  = b.layer === 2 ? '#C9A06A' : '#3D6E50';
    const strokeC = b.layer === 2 ? 'rgba(255,220,150,.5)' : 'rgba(0,0,0,.4)';
    ctx.fillStyle = fillC;
    ctx.fillRect(margin + r.x * scale, margin + r.y * scale, r.w * scale, r.h * scale);
    ctx.strokeStyle = strokeC;
    ctx.lineWidth = b.layer === 2 ? 1 : .5;
    ctx.strokeRect(margin + r.x * scale, margin + r.y * scale, r.w * scale, r.h * scale);
    if (b.layer === 2 && r.w * scale > 18 && r.h * scale > 12) {
      ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = 'bold 9px Verdana';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('2', margin + r.x * scale + r.w * scale / 2, margin + r.y * scale + r.h * scale / 2);
    }
  });

  ctx.fillStyle = '#6B655B'; ctx.font = '11px Verdana'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillText({ top: 'üstten görünüm (uzunluk × genişlik)', front: 'önden görünüm (genişlik × yükseklik)', side: 'yandan görünüm (uzunluk × yükseklik)' }[view],
    margin, vH * scale + margin + 6);
}

// ─── Yardımcılar ─────────────────────────────────────────────
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function showToast(msg) {
  const t = document.getElementById('ep-toast');
  if (!t) return;
  t.textContent = msg; t.style.display = 'block';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.display = 'none'; }, 2500);
}
