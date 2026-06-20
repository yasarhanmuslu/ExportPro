// ═══════════════════════════════════════════════════════════════
// EXPORTPRO - INTERACTIVE PRESENTATION SCRIPT
// ═══════════════════════════════════════════════════════════════

// --- THEME MANAGEMENT ---
const html = document.documentElement;
const themeToggle = document.getElementById('theme-toggle');
const themeIcon = document.getElementById('theme-icon');

function initTheme() {
    const savedTheme = localStorage.getItem('ep-theme') || 'dark';
    if (savedTheme === 'dark') {
        html.classList.add('dark');
        themeIcon.className = 'fa-solid fa-sun';
    } else {
        html.classList.remove('dark');
        themeIcon.className = 'fa-solid fa-moon';
    }
}

themeToggle.addEventListener('click', () => {
    if (html.classList.contains('dark')) {
        html.classList.remove('dark');
        localStorage.setItem('ep-theme', 'light');
        themeIcon.className = 'fa-solid fa-moon';
    } else {
        html.classList.add('dark');
        localStorage.setItem('ep-theme', 'dark');
        themeIcon.className = 'fa-solid fa-sun';
    }
});

initTheme();

// --- MULTI-PAGE PATHS & REDIRECT LINKS ---
const STEP_FILES = [
    { file: 'index.html', path: 'index.html' },
    { file: 'loading-planner.html', path: 'loading-planner.html' },
    { file: 'order-timeline.html', path: 'order-timeline.html' },
    { file: 'profitability.html', path: 'profitability.html' },
    { file: 'customer-score.html', path: 'customer-score.html' }
];

function updateBrowserPath(stepIndex) {
    const stepConfig = STEP_FILES[stepIndex];
    document.getElementById('browser-path').textContent = stepConfig.file;
    document.getElementById('btn-real-link').href = stepConfig.path;
}

// --- STATE MANAGEMENT ---
let currentStep = 0;
let isPlaying = false;
let tourInterval = null;
let typingTimeout = null;
let currentSpeed = 1; // Speed factor multiplier

const stepViews = document.querySelectorAll('.simulator-view');
const navBtns = document.querySelectorAll('.nav-mock-btn');

function showStep(index) {
    stepViews.forEach((view, i) => {
        if (i === index) {
            view.classList.remove('hidden');
        } else {
            view.classList.add('hidden');
        }
    });

    navBtns.forEach((btn, i) => {
        if (i === index) {
            btn.classList.add('nav-mock-active', 'border-emerald-800');
        } else {
            btn.classList.remove('nav-mock-active', 'border-emerald-800');
        }
    });

    currentStep = index;
    updateBrowserPath(index);
    document.getElementById('tour-progress-text').textContent = `Modül: ${index + 1} / 5`;
    
    // Trigger step-specific animations
    triggerStepAnimations(index);
}

// Event Listeners for manual tab switching
navBtns.forEach((btn) => {
    btn.addEventListener('click', (e) => {
        if (isPlaying) stopTour();
        const step = parseInt(btn.getAttribute('data-step'));
        showStep(step);
    });
});

// --- STEP ANIMATIONS ---

// Step 0: Dashboard counter animation
function animateCounters() {
    const counters = document.querySelectorAll('.counter');
    counters.forEach(counter => {
        const target = parseInt(counter.getAttribute('data-val'));
        let current = 0;
        const stepTime = Math.max(Math.floor(target / 40), 1);
        
        counter.textContent = '0';
        const timer = setInterval(() => {
            current += stepTime;
            if (current >= target) {
                counter.textContent = target.toLocaleString('tr-TR');
                clearInterval(timer);
            } else {
                counter.textContent = current.toLocaleString('tr-TR');
            }
        }, 30);
    });
}

// Step 1: Loading planner container packing simulation
const containerGrid = document.getElementById('container-grid');
const colors = ['bg-emerald-700', 'bg-emerald-600', 'bg-teal-700', 'bg-emerald-800', 'bg-teal-600', 'bg-bronzeAccent'];

function simulatePacking() {
    containerGrid.innerHTML = '';
    
    const totalPallets = 22;
    let currentPallet = 0;
    
    const countEl = document.getElementById('load-pallets-count');
    const weightEl = document.getElementById('load-weight');
    const volEl = document.getElementById('load-volume');
    const ratioEl = document.getElementById('load-ratio');
    
    countEl.textContent = '0 / 22';
    weightEl.textContent = '0 kg';
    volEl.textContent = '0 m³';
    ratioEl.textContent = '0%';
    
    const intervalTime = 300 / currentSpeed;

    const timer = setInterval(() => {
        if (currentPallet >= totalPallets) {
            clearInterval(timer);
            return;
        }
        
        currentPallet++;
        
        // Add animated pallet box to container mockup
        const box = document.createElement('div');
        const color = colors[currentPallet % colors.length];
        box.className = `pallet-box ${color} text-white font-mono text-[9px] flex items-center justify-center rounded border border-white/20 shadow-sm opacity-0 transform translate-y-4`;
        box.style.width = '42px';
        box.style.height = '36px';
        box.innerHTML = `P${currentPallet}`;
        
        containerGrid.appendChild(box);
        
        // Animate appearance
        setTimeout(() => {
            box.classList.remove('opacity-0', 'translate-y-4');
        }, 50);

        // Update stats progressively
        const currentWeight = currentPallet * 980; // 980kg per pallet
        const currentVolume = (currentPallet * 1.8).toFixed(1); // 1.8m3 per pallet
        const currentRatio = Math.round((currentPallet / totalPallets) * 92); // Max 92% capacity

        countEl.textContent = `${currentPallet} / 22`;
        weightEl.textContent = `${currentWeight.toLocaleString('tr-TR')} kg`;
        volEl.textContent = `${currentVolume} m³`;
        ratioEl.textContent = `${currentRatio}%`;

    }, intervalTime);
}

document.getElementById('btn-animate-loading').addEventListener('click', simulatePacking);

// Step 2: Timeline progress bar animation
function animateTimeline() {
    const progress = document.getElementById('timeline-progress');
    const dots = [
        document.getElementById('dot-0'),
        document.getElementById('dot-1'),
        document.getElementById('dot-2'),
        document.getElementById('dot-3'),
        document.getElementById('dot-4')
    ];
    
    progress.style.width = '0%';
    dots.forEach(dot => {
        dot.className = 'timeline-dot w-9 h-9 rounded-full bg-zinc-200 dark:bg-zinc-800 border-2 border-zinc-300 dark:border-zinc-700 flex items-center justify-center text-xs font-bold text-zinc-500 transition-all duration-300';
    });
    
    const steps = [
        { width: '0%', dot: 0 },
        { width: '25%', dot: 1 },
        { width: '50%', dot: 2 },
        { width: '75%', dot: 3 }
    ];
    
    let currentDot = 0;
    
    const intervalTime = 600 / currentSpeed;

    const timer = setInterval(() => {
        if (currentDot >= steps.length) {
            clearInterval(timer);
            return;
        }
        
        const step = steps[currentDot];
        progress.style.width = step.width;
        
        const dot = dots[step.dot];
        dot.className = 'timeline-dot w-10 h-10 rounded-full bg-emerald-800 border-2 border-emerald-500 text-white flex items-center justify-center text-xs font-bold shadow-lg transform scale-110 highlight-pulse transition-all';
        
        // Remove scale/highlight from previous dot
        if (step.dot > 0) {
            const prevDot = dots[step.dot - 1];
            prevDot.className = 'timeline-dot w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-950/60 border-2 border-emerald-700 text-emerald-800 dark:text-emerald-300 flex items-center justify-center text-xs font-bold transition-all';
        }
        
        currentDot++;
    }, intervalTime);
}

// Step 3: Profitability line chart & recalculator
let profitChart = null;

function setupProfitChart() {
    const ctx = document.getElementById('profitChart').getContext('2d');
    
    // Destroy previous chart if it exists
    if (profitChart) {
        profitChart.destroy();
    }
    
    const isDark = html.classList.contains('dark');
    const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)';
    const textColor = isDark ? '#a1a1aa' : '#52525b';

    profitChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz'],
            datasets: [{
                label: 'Aylık Net Kâr',
                data: [12400, 15800, 14200, 19100, 24300, 28100],
                borderColor: '#049669',
                backgroundColor: 'rgba(4, 150, 105, 0.05)',
                borderWidth: 3,
                tension: 0.3,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    grid: { color: gridColor },
                    ticks: { color: textColor, font: { family: 'Verdana', size: 9 } }
                },
                y: {
                    grid: { color: gridColor },
                    ticks: { color: textColor, font: { family: 'Verdana', size: 9 } }
                }
            }
        }
    });
}

function updateProfitRecalculator() {
    const clayVal = parseInt(document.getElementById('slider-clay').value);
    const energyVal = parseInt(document.getElementById('slider-energy').value);
    
    document.getElementById('clay-val').textContent = `$${clayVal}`;
    document.getElementById('energy-val').textContent = `%${energyVal}`;
    
    // Simple math simulation
    // Base cost: $25. Clay adds $0.05 per dollar above 80. Energy adds $0.15 per percent
    const baseCost = 25 + (clayVal - 80) * 0.08 + energyVal * 0.18;
    const salePrice = (baseCost * 1.48).toFixed(2); // 48% target markup
    const profitRatio = (((salePrice - baseCost) / salePrice) * 100).toFixed(1);
    
    document.getElementById('calculated-sale-price').textContent = `$${salePrice} / Kutu`;
    document.getElementById('calculated-profit-ratio').textContent = `%${profitRatio}`;
    
    // Update chart scale based on raw clay values as cost factor
    if (profitChart) {
        const factor = 1 - (clayVal - 120) / 300 - (energyVal / 200);
        profitChart.data.datasets[0].data = [
            Math.round(12400 * factor),
            Math.round(15800 * factor),
            Math.round(14200 * factor),
            Math.round(19100 * factor),
            Math.round(24300 * factor),
            Math.round(28100 * factor)
        ];
        profitChart.update('none');
    }
}

document.getElementById('slider-clay').addEventListener('input', updateProfitRecalculator);
document.getElementById('slider-energy').addEventListener('input', updateProfitRecalculator);

// Step 4: Customer Score Gauge & selection
const customerData = {
    pworld: {
        score: 95,
        label: 'MÜKEMMEL (AAA)',
        color: '#059669',
        vade: '14 Gün',
        sikayet: '%0.4',
        siparis: '24 Adet',
        limit: '$250,000'
    },
    ceramica: {
        score: 82,
        label: 'GÜVENLİ (B)',
        color: '#3b82f6',
        vade: '30 Gün',
        sikayet: '%1.2',
        siparis: '16 Adet',
        limit: '$120,000'
    },
    clayimp: {
        score: 54,
        label: 'RİSKLİ (C)',
        color: '#ef4444',
        vade: '60 Gün (Gecikmeli)',
        sikayet: '%4.8',
        siparis: '8 Adet',
        limit: '$30,000'
    }
};

function updateCustomerScore(customerId) {
    const data = customerData[customerId];
    const scoreVal = document.getElementById('gauge-value');
    const scoreLbl = document.getElementById('gauge-label');
    const circle = document.getElementById('gauge-circle');
    
    // Stats elements
    document.getElementById('detail-payment-days').textContent = data.vade;
    document.getElementById('detail-complaint-rate').textContent = data.sikayet;
    document.getElementById('detail-order-count').textContent = data.siparis;
    document.getElementById('detail-credit-limit').textContent = data.limit;
    
    scoreLbl.textContent = data.label;
    scoreLbl.style.color = data.color;
    
    // Animate Radial Score
    let currentScore = 0;
    const timer = setInterval(() => {
        currentScore += 2;
        if (currentScore >= data.score) {
            scoreVal.textContent = data.score;
            clearInterval(timer);
        } else {
            scoreVal.textContent = currentScore;
        }
    }, 15);
    
    // Set circle offset: 339.292 is the perimeter of r=54 circle
    // Percentage to stroke-dashoffset conversion
    const perimeter = 339.292;
    const offset = perimeter - (data.score / 100) * perimeter;
    circle.setAttribute('stroke', data.color);
    circle.style.strokeDashoffset = offset;
}

document.getElementById('select-mock-customer').addEventListener('change', (e) => {
    updateCustomerScore(e.target.value);
});

// Trigger all actions when step switches
function triggerStepAnimations(index) {
    if (index === 0) {
        animateCounters();
    } else if (index === 1) {
        simulatePacking();
    } else if (index === 2) {
        animateTimeline();
    } else if (index === 3) {
        setupProfitChart();
        updateProfitRecalculator();
    } else if (index === 4) {
        updateCustomerScore('pworld');
    }
}

// --- AUTOMATIC SUNUM PLAYBACK ---

const TOUR_TIMELINE = [
    {
        step: 0,
        text: "ExportPro Dashboard'a hoş geldiniz. Burası ihracat operasyonlarınızın merkez üssüdür. Entegre Supabase veritabanınızdan gerçek zamanlı siparişleri, hacimleri ve TCMB döviz kur bilgilerini çeker.",
        duration: 8000
    },
    {
        step: 1,
        text: "Şimdi Yükleme Planlayıcı modülünü inceliyoruz. Lojistik maliyetleri optimize etmek kritik önem taşır. Konteyner veya tır hacminizi otomatik modelleyerek palet yerleşim simülasyonunu anlık gerçekleştirir.",
        duration: 9000
    },
    {
        step: 2,
        text: "Sipariş Operasyon Takvimi ile hiçbir teslimat gecikmez. Üretim bandından başlayarak gümrük, liman ve gemi seyir süreçlerini zaman tüneli üzerinde miladlarıyla birlikte izler ve olası gecikmelerde alarmlar üretir.",
        duration: 8500
    },
    {
        step: 3,
        text: "Fiyat Robotu ve Kârlılık ekranındayız. Killi çamur veya doğalgaz zamları gibi dinamik maliyet girdilerini buradaki kontrol slider'larıyla değiştirdiğinizde, sistem satış fiyatını ve net kâr oranınızı anında günceller.",
        duration: 10000
    },
    {
        step: 4,
        text: "Son olarak Müşteri Skoru modülü. Müşterilerinizin geçmiş vade performansını, yıllık sipariş sıklıklarını ve finansal risk oranını Yapay Zekayla analiz ederek güvenilirlik puanı (A/B/C) verir ve riski minimize eder.",
        duration: 9000
    },
    {
        step: 0,
        text: "ExportPro interaktif turunu tamamladınız! Şimdi aşağıdaki modüller dizininden gerçek sayfalara erişip kendi verilerinizle çalışmaya başlayabilirsiniz.",
        duration: 6000
    }
];

function typeWriter(text, element, speed = 25) {
    clearTimeout(typingTimeout);
    element.textContent = '';
    let i = 0;
    
    function type() {
        if (i < text.length) {
            element.textContent += text.charAt(i);
            i++;
            typingTimeout = setTimeout(type, speed / currentSpeed);
        }
    }
    type();
}

function startTour() {
    isPlaying = true;
    document.getElementById('play-icon').className = 'fa-solid fa-pause';
    document.getElementById('play-text').textContent = 'Sunumu Duraklat';
    document.getElementById('tour-status-label').innerHTML = `<span class="w-2 h-2 rounded-full bg-red-500 animate-ping"></span> Sunum Oynatılıyor`;
    
    let currentPhase = 0;
    
    function runPhase() {
        if (!isPlaying) return;
        
        if (currentPhase >= TOUR_TIMELINE.length) {
            stopTour();
            return;
        }
        
        const phase = TOUR_TIMELINE[currentPhase];
        showStep(phase.step);
        
        const subtitleEl = document.getElementById('presenter-subtitles');
        typeWriter(phase.text, subtitleEl);
        
        const duration = phase.duration / currentSpeed;
        
        currentPhase++;
        tourInterval = setTimeout(runPhase, duration);
    }
    
    runPhase();
}

function stopTour() {
    isPlaying = false;
    clearTimeout(tourInterval);
    clearTimeout(typingTimeout);
    document.getElementById('play-icon').className = 'fa-solid fa-play';
    document.getElementById('play-text').textContent = 'Oto-Sunumu Başlat';
    document.getElementById('tour-status-label').innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span> Bekliyor`;
}

document.getElementById('btn-play-tour').addEventListener('click', () => {
    if (isPlaying) {
        stopTour();
    } else {
        startTour();
    }
});

document.getElementById('select-speed').addEventListener('change', (e) => {
    currentSpeed = parseFloat(e.target.value);
    // Restart active phase with new speed if playing
    if (isPlaying) {
        stopTour();
        startTour();
    }
});

// Initialize with step 0 on load
showStep(0);
