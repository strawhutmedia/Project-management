/**
 * Straw Hut Media — Podcast Quote Builder Widget
 *
 * USAGE: Add these two lines anywhere in your HTML:
 *   <div id="shm-quote-widget"></div>
 *   <script src="widget.js"></script>
 *
 * Self-initializing. Zero dependencies. All styles scoped to #shm-quote-widget.
 */
(function() {
  var WIDGET_ID = 'shm-quote-widget';
  var root = document.getElementById(WIDGET_ID);
  if (!root) return;

  // ── Inject scoped styles ──────────────────────────────────────
  var style = document.createElement('style');
  style.textContent = [
    "#shm-quote-widget{--shm-navy:#12182f;--shm-navy-light:#232c4e;--shm-green:#00cc8e;--shm-green-hover:#00e6a0;--shm-green-soft:rgba(0,204,142,.1);--shm-white:#fff;--shm-g50:#f8f9fa;--shm-g100:#f0f1f3;--shm-g200:#e2e4e8;--shm-g400:#9ca3af;--shm-g500:#6b7280;--shm-g700:#374151;--shm-g800:#1f2937;font-family:'Poppins',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;width:100%;max-width:560px;margin:0 auto}",
    "#shm-quote-widget *{box-sizing:border-box;margin:0;padding:0}",
    "#shm-quote-widget .shm-card{background:var(--shm-white);border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.12);overflow:hidden}",
    "#shm-quote-widget .shm-progress{height:4px;background:var(--shm-g100);width:100%}",
    "#shm-quote-widget .shm-progress-fill{height:100%;background:var(--shm-green);transition:width .4s ease;border-radius:0 2px 2px 0}",
    "#shm-quote-widget .shm-step{display:none;padding:40px 36px;animation:shmFadeIn .35s ease}",
    "#shm-quote-widget .shm-step.active{display:block}",
    "@keyframes shmFadeIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}",
    "#shm-quote-widget .shm-counter{font-size:.78rem;font-weight:600;color:var(--shm-green);text-transform:uppercase;letter-spacing:1px;margin-bottom:12px}",
    "#shm-quote-widget .shm-step h2{font-size:1.5rem;font-weight:800;color:var(--shm-navy);line-height:1.3;margin-bottom:8px}",
    "#shm-quote-widget .shm-subtitle{font-size:.92rem;color:var(--shm-g500);line-height:1.5;margin-bottom:28px}",
    "#shm-quote-widget .shm-options{display:flex;flex-direction:column;gap:12px;margin-bottom:32px}",
    "#shm-quote-widget .shm-opt{display:flex;align-items:center;gap:16px;padding:18px 20px;border:2px solid var(--shm-g200);border-radius:12px;cursor:pointer;transition:all .2s}",
    "#shm-quote-widget .shm-opt:hover,#shm-quote-widget .shm-opt.sel{border-color:var(--shm-green);background:var(--shm-green-soft)}",
    "#shm-quote-widget .shm-icon{width:44px;height:44px;border-radius:10px;background:var(--shm-g50);display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background .2s}",
    "#shm-quote-widget .shm-opt.sel .shm-icon{background:var(--shm-green)}",
    "#shm-quote-widget .shm-icon svg{width:22px;height:22px;stroke:var(--shm-g500);fill:none;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;transition:stroke .2s}",
    "#shm-quote-widget .shm-opt.sel .shm-icon svg{stroke:var(--shm-white)}",
    "#shm-quote-widget .shm-txt{flex:1}",
    "#shm-quote-widget .shm-label{font-size:.95rem;font-weight:600;color:var(--shm-navy);margin-bottom:2px}",
    "#shm-quote-widget .shm-desc{font-size:.82rem;color:var(--shm-g500);line-height:1.4}",
    "#shm-quote-widget .shm-chk{width:22px;height:22px;border:2px solid var(--shm-g200);border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:all .2s}",
    "#shm-quote-widget .shm-opt.sel .shm-chk{background:var(--shm-green);border-color:var(--shm-green)}",
    "#shm-quote-widget .shm-chk svg{width:12px;height:12px;fill:none;stroke:var(--shm-white);stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round;opacity:0;transition:opacity .15s}",
    "#shm-quote-widget .shm-opt.sel .shm-chk svg{opacity:1}",
    "#shm-quote-widget .shm-multi .shm-chk{border-radius:6px}",
    "#shm-quote-widget .shm-toggle-row{display:none;align-items:center;gap:12px;padding:16px 20px;margin-top:4px;border:2px solid var(--shm-g200);border-radius:12px;cursor:pointer;transition:all .2s}",
    "#shm-quote-widget .shm-toggle-row.visible{display:flex}",
    "#shm-quote-widget .shm-toggle-row:hover{border-color:var(--shm-green);background:var(--shm-green-soft)}",
    "#shm-quote-widget .shm-toggle-row.sel{border-color:var(--shm-green);background:var(--shm-green-soft)}",
    "#shm-quote-widget .shm-toggle-box{width:22px;height:22px;border:2px solid var(--shm-g200);border-radius:6px;flex-shrink:0;display:flex;align-items:center;justify-content:center;transition:all .2s}",
    "#shm-quote-widget .shm-toggle-row.sel .shm-toggle-box{background:var(--shm-green);border-color:var(--shm-green)}",
    "#shm-quote-widget .shm-toggle-box svg{width:12px;height:12px;fill:none;stroke:var(--shm-white);stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round;opacity:0;transition:opacity .15s}",
    "#shm-quote-widget .shm-toggle-row.sel .shm-toggle-box svg{opacity:1}",
    "#shm-quote-widget .shm-nav{display:flex;justify-content:space-between;align-items:center;gap:12px}",
    "#shm-quote-widget .shm-btn{padding:14px 28px;border-radius:50px;font-size:.92rem;font-weight:600;cursor:pointer;transition:all .2s;border:none;font-family:inherit}",
    "#shm-quote-widget .shm-back{background:transparent;color:var(--shm-g500);padding:14px 20px}",
    "#shm-quote-widget .shm-back:hover{color:var(--shm-navy)}",
    "#shm-quote-widget .shm-next{background:var(--shm-green);color:var(--shm-white);margin-left:auto}",
    "#shm-quote-widget .shm-next:hover{background:var(--shm-green-hover);transform:translateY(-1px)}",
    "#shm-quote-widget .shm-next:disabled{background:var(--shm-g200);color:var(--shm-g400);cursor:not-allowed;transform:none}",
    "#shm-quote-widget .shm-result-box{background:linear-gradient(135deg,var(--shm-navy),var(--shm-navy-light));border-radius:12px;padding:28px 24px;text-align:center;margin-bottom:24px;position:relative;overflow:hidden}",
    "#shm-quote-widget .shm-result-box::before{content:'';position:absolute;top:-30px;right:-30px;width:120px;height:120px;background:rgba(45,212,160,.1);border-radius:50%}",
    "#shm-quote-widget .shm-badge{display:inline-block;background:var(--shm-green);color:var(--shm-white);font-size:.72rem;font-weight:700;padding:4px 12px;border-radius:20px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:16px}",
    "#shm-quote-widget .shm-pkg-name{font-size:1.3rem;font-weight:800;color:var(--shm-white);margin-bottom:8px}",
    "#shm-quote-widget .shm-price{font-size:2.4rem;font-weight:800;color:var(--shm-green);margin-bottom:4px}",
    "#shm-quote-widget .shm-period{font-size:.82rem;color:var(--shm-g400)}",
    "#shm-quote-widget .shm-features{margin-bottom:28px}",
    "#shm-quote-widget .shm-features h4{font-size:.82rem;font-weight:700;color:var(--shm-g400);text-transform:uppercase;letter-spacing:.5px;margin-bottom:14px}",
    "#shm-quote-widget .shm-feat{display:flex;align-items:flex-start;gap:10px;padding:8px 0;font-size:.88rem;color:var(--shm-g700)}",
    "#shm-quote-widget .shm-feat-chk{width:18px;height:18px;background:var(--shm-green-soft);border-radius:50%;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px}",
    "#shm-quote-widget .shm-feat-chk svg{width:10px;height:10px;fill:none;stroke:var(--shm-green);stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}",
    "#shm-quote-widget .shm-cta{display:block;width:100%;padding:16px;background:var(--shm-green);color:var(--shm-white);border:none;border-radius:50px;font-size:1rem;font-weight:700;cursor:pointer;transition:all .2s;font-family:inherit;text-align:center;margin-bottom:8px}",
    "#shm-quote-widget .shm-cta:hover{background:var(--shm-green-hover);transform:translateY(-1px)}",
    "#shm-quote-widget .shm-restart{display:block;width:100%;padding:12px;background:transparent;color:var(--shm-g500);border:none;font-size:.85rem;font-weight:600;cursor:pointer;font-family:inherit;text-align:center}",
    "#shm-quote-widget .shm-restart:hover{color:var(--shm-navy)}",
    "#shm-quote-widget .shm-footnote{text-align:center;font-size:.75rem;color:var(--shm-g400);margin-top:12px}",
    "@media(max-width:600px){#shm-quote-widget .shm-step{padding:28px 24px}#shm-quote-widget .shm-step h2{font-size:1.3rem}#shm-quote-widget .shm-opt{padding:14px 16px;gap:12px}#shm-quote-widget .shm-icon{width:38px;height:38px}}"
  ].join("\n");
  document.head.appendChild(style);

  // ── Configuration ────────────────────────────────────────────
  // Replace with your Calendly scheduling URL
  var CALENDLY_URL = 'https://calendly.com/strawhutmedia/discovery';

  // ── Helpers ────────────────────────────────────────────────────
  var CHK = '<svg viewBox="0 0 16 16"><polyline points="3.5 8 6.5 11 12.5 5"/></svg>';

  function iconWrap(svg) { return '<div class="shm-icon">' + svg + '</div>'; }
  function optHtml(value, iconSvg, label, desc) {
    return '<div class="shm-opt" data-value="' + value + '">' +
      iconWrap(iconSvg) +
      '<div class="shm-txt"><div class="shm-label">' + label + '</div><div class="shm-desc">' + desc + '</div></div>' +
      '<div class="shm-chk">' + CHK + '</div></div>';
  }

  // ── SVG Icons ─────────────────────────────────────────────────
  var ICONS = {
    mic: '<svg viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>',
    video: '<svg viewBox="0 0 24 24"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/></svg>',
    monitor: '<svg viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
    home: '<svg viewBox="0 0 24 24"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
    pin: '<svg viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    image: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
    share: '<svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>',
    calendar: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    chart: '<svg viewBox="0 0 24 24"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
    no: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>',
    instagram: '<svg viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>',
    social: '<svg viewBox="0 0 24 24"><path d="M23 3a10.9 10.9 0 0 1-3.14 1.53 4.48 4.48 0 0 0-7.86 3v1A10.66 10.66 0 0 1 3 4s-4 9 5 13a11.64 11.64 0 0 1-7 2c9 5 20 0 20-11.5a4.5 4.5 0 0 0-.08-.83A7.72 7.72 0 0 0 23 3z"/></svg>',
    grid: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>',
    layers: '<svg viewBox="0 0 24 24"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>',
    user: '<svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    users: '<svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    group: '<svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    userplus: '<svg viewBox="0 0 24 24"><path d="M15 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M20 8v6"/><path d="M23 11h-6"/></svg>',
    scissors: '<svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>',
    tool: '<svg viewBox="0 0 24 24"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
    shield: '<svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    chat: '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    filetext: '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    repeat: '<svg viewBox="0 0 24 24"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>',
    clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    hash: '<svg viewBox="0 0 24 24"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>',
    send: '<svg viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>'
  };

  // ── Steps Data (reordered: service level at step 3) ───────────
  // skipIf returns true when the step should be skipped
  var stepsData = [
    {
      key: 'podcastType', required: true, multi: false,
      title: 'What type of podcast are you creating?',
      subtitle: 'This helps us determine the right equipment and setup for your show.',
      options: [
        { value: 'audio', icon: 'mic', label: 'Audio Only', desc: 'Classic podcast format \u2014 polished, professional audio delivered to all platforms' },
        { value: 'video', icon: 'video', label: 'Audio + Video', desc: 'Full video production for YouTube, social media, and beyond' }
      ]
    },
    {
      key: 'podcastStyle', required: true, multi: false,
      title: 'What style is your podcast?',
      subtitle: 'Different formats need different production approaches.',
      options: [
        { value: 'conversational', icon: 'chat', label: 'Conversational', desc: 'Interviews, co-hosted discussions, or casual conversations' },
        { value: 'scripted', icon: 'filetext', label: 'Scripted / Journalistic', desc: 'Narrative storytelling, investigative reporting, or scripted episodes' },
        { value: 'monologue', icon: 'edit', label: 'Essay / Monologue', desc: 'Solo commentary, thought leadership, or essay-style episodes' }
      ]
    },
    {
      key: 'serviceLevel', required: true, multi: false,
      title: 'What level of service do you need?',
      subtitle: 'This determines which questions we\u2019ll ask next.',
      options: [
        { value: 'editing-only', icon: 'scissors', label: 'Editing Only', desc: 'You record, we edit \u2014 you get polished audio (and video) files back' },
        { value: 'production-only', icon: 'tool', label: 'Production Only', desc: 'We handle recording and editing \u2014 you get the finished files to publish yourself' },
        { value: 'full-service', icon: 'shield', label: 'Full Service \u2014 Done for You', desc: 'We handle everything: recording, editing, publishing, and promotion' }
      ]
    },
    {
      key: 'micCount', required: true, multi: false,
      skipIf: function() { return answers.serviceLevel === 'editing-only'; },
      title: 'How many people will be on mic?',
      subtitle: 'This helps us plan the right number of microphones and cameras for your setup.',
      options: [
        { value: 'solo', icon: 'user', label: 'Just the Host', desc: 'Solo show \u2014 1 mic, 1 camera' },
        { value: 'two', icon: 'users', label: 'Host + 1 Guest', desc: 'Interview or co-host format \u2014 2 mics, 2 cameras' },
        { value: 'three', icon: 'group', label: 'Host + 2 Guests', desc: 'Panel or roundtable \u2014 3 mics, 3 cameras' },
        { value: 'four-plus', icon: 'userplus', label: 'Host + 3 or More Guests', desc: 'Large panel \u2014 4+ mics, multi-camera setup' }
      ]
    },
    {
      key: 'frequency', required: true, multi: false,
      title: 'How often will you release episodes?',
      subtitle: 'This helps us scope the ongoing production workload.',
      options: [
        { value: 'weekly', icon: 'repeat', label: 'Weekly', desc: 'New episode every week \u2014 the standard for growing audiences' },
        { value: 'every-other-week', icon: 'calendar', label: 'Every Other Week', desc: 'Bi-weekly release schedule' },
        { value: 'monthly', icon: 'clock', label: 'Once a Month', desc: 'Monthly deep-dive episodes' },
        { value: 'limited-run', icon: 'hash', label: 'Limited Run Series', desc: 'A set number of episodes (e.g. 6\u201312 episode season)' }
      ]
    },
    {
      key: 'recordingLocation', required: true, multi: false,
      skipIf: function() { return answers.serviceLevel === 'editing-only'; },
      title: 'Where will you be recording?',
      subtitle: 'Choose the recording setup that works best for your show.',
      options: [
        { value: 'virtual', icon: 'monitor', label: 'Virtual / Remote', desc: 'Record from anywhere with our remote setup support' },
        { value: 'studio', icon: 'home', label: 'In Our Studio', desc: 'Record at our professional studio on Melrose Avenue' },
        { value: 'on-location', icon: 'pin', label: 'On-Location', desc: 'We come to you \u2014 anywhere you need us to be' }
      ]
    },
    {
      key: 'branding', required: false, multi: true,
      title: 'Do you need branding and distribution?',
      subtitle: 'Select all that apply to your needs.',
      options: [
        { value: 'cover-art', icon: 'image', label: 'Custom Branding Package', desc: 'Professional cover art and logo designed for your show' },
        { value: 'distribution', icon: 'share', label: 'Distribution to All Major Platforms', desc: 'Apple Podcasts, Spotify, Google, and more' },
        { value: 'scheduling', icon: 'calendar', label: 'Booking & Scheduling Coordination', desc: 'We coordinate with hosts, guests, and studio space to get sessions on the books' },
        { value: 'analytics', icon: 'chart', label: 'Analytics & Growth Tracking', desc: 'Monitor your performance and listener trends' }
      ]
    },
    {
      key: 'social', required: true, multi: false,
      skipIf: function() { return answers.serviceLevel === 'production-only'; },
      hasToggle: true,
      toggleKey: 'socialManagement',
      toggleLabel: 'Also manage our social media posting',
      toggleDesc: 'We\u2019ll schedule and post content to your accounts \u2014 not just deliver the assets',
      title: 'How about social media content?',
      subtitle: 'Grow your audience with promotional content for each episode.',
      options: [
        { value: 'none', icon: 'no', label: 'No Social Media Content', desc: "I'll handle my own social media promotion" },
        { value: '1-asset', icon: 'instagram', label: '1 Asset per Episode', desc: 'One polished clip or graphic to promote each episode' },
        { value: '3-assets', icon: 'grid', label: '3 Assets per Episode', desc: 'A mix of clips, audiograms, and graphics per episode' },
        { value: '7-10-assets', icon: 'layers', label: '7\u201310 Assets per Episode', desc: 'Full content suite: clips, reels, carousels, audiograms, and graphics' }
      ]
    }
  ];

  // ── Pricing ───────────────────────────────────────────────────
  var BASE_PRICE = 1500;
  var PRICING = {
    format: { audio: 0, video: 800 },
    podcastStyle: { conversational: 0, scripted: 400, monologue: 0 },
    micCount: { solo: 0, two: 200, three: 400, 'four-plus': 700 },
    frequency: { weekly: 0, 'every-other-week': -400, monthly: -600, 'limited-run': -200 },
    location: { virtual: 0, studio: 400, 'on-location': 1200 },
    branding: { 'cover-art': 400, distribution: 200, scheduling: 300, analytics: 200 },
    social: { none: 0, '1-asset': 200, '3-assets': 500, '7-10-assets': 1000 },
    socialManagement: 300,
    serviceLevel: { 'editing-only': 0, 'production-only': 500, 'full-service': 1200 }
  };
  var MIN_PRICE = 500;

  // ── State ─────────────────────────────────────────────────────
  var answers = {};
  var currentStep = 0;
  var totalSteps = stepsData.length;

  // ── Step skip logic ───────────────────────────────────────────
  function isStepVisible(idx) {
    return !(stepsData[idx].skipIf && stepsData[idx].skipIf());
  }

  function getVisibleSteps() {
    var visible = [];
    for (var i = 0; i < totalSteps; i++) {
      if (isStepVisible(i)) visible.push(i);
    }
    return visible;
  }

  function getNextVisible(fromIdx) {
    for (var i = fromIdx + 1; i < totalSteps; i++) {
      if (isStepVisible(i)) return i;
    }
    return 'result';
  }

  function getPrevVisible(fromIdx) {
    for (var i = fromIdx - 1; i >= 0; i--) {
      if (isStepVisible(i)) return i;
    }
    return 0;
  }

  // ── Build HTML ────────────────────────────────────────────────
  var html = '<div class="shm-card">';
  html += '<div class="shm-progress"><div class="shm-progress-fill" id="shm-progress" style="width:12.5%"></div></div>';

  for (var i = 0; i < totalSteps; i++) {
    var s = stepsData[i];
    html += '<div class="shm-step' + (i === 0 ? ' active' : '') + '" data-step="' + i + '">';
    html += '<div class="shm-counter" id="shm-counter-' + i + '"></div>';
    html += '<h2>' + s.title + '</h2>';
    html += '<p class="shm-subtitle">' + s.subtitle + '</p>';
    html += '<div class="shm-options' + (s.multi ? ' shm-multi' : '') + '" data-key="' + s.key + '">';
    for (var j = 0; j < s.options.length; j++) {
      var o = s.options[j];
      html += optHtml(o.value, ICONS[o.icon], o.label, o.desc);
    }
    html += '</div>';
    if (s.hasToggle) {
      html += '<div class="shm-toggle-row" id="shm-toggle-' + s.toggleKey + '" data-toggle-key="' + s.toggleKey + '">';
      html += '<div class="shm-toggle-box">' + CHK + '</div>';
      html += '<div class="shm-txt"><div class="shm-label">' + s.toggleLabel + '</div><div class="shm-desc">' + s.toggleDesc + '</div></div>';
      html += '</div>';
    }
    html += '<div class="shm-nav">';
    html += '<button class="shm-btn shm-back" id="shm-back-' + i + '" style="' + (i === 0 ? 'visibility:hidden' : '') + '">Back</button>';
    html += '<button class="shm-btn shm-next" id="shm-next-' + i + '"' + (s.required ? ' disabled' : '') + '>Continue</button>';
    html += '</div></div>';
  }

  // Result step
  html += '<div class="shm-step" data-step="result">';
  html += '<div class="shm-counter">Your Custom Quote</div>';
  html += '<h2>Here\'s your personalized quote</h2>';
  html += '<p class="shm-subtitle">Based on your selections, here\'s what we recommend:</p>';
  html += '<div class="shm-result-box">';
  html += '<div class="shm-badge" id="shm-badge">Your Quote</div>';
  html += '<div class="shm-pkg-name" id="shm-pkg-name"></div>';
  html += '<div class="shm-price" id="shm-pkg-price"></div>';
  html += '<div class="shm-period" id="shm-period">per month</div></div>';
  html += '<div class="shm-features"><h4>What\'s Included</h4><div id="shm-feat-list"></div></div>';
  html += '<button class="shm-cta" id="shm-cta">Schedule a Call to Get Started</button>';
  html += '<button class="shm-restart" id="shm-restart">Start Over</button>';
  html += '<div class="shm-footnote">Final pricing confirmed after consultation \u2014 your quiz answers will be included in the invite</div></div>';
  html += '</div>';

  root.innerHTML = html;

  // ── Wire up interactions ──────────────────────────────────────
  var allSteps = root.querySelectorAll('.shm-step');
  var progressBar = document.getElementById('shm-progress');

  function updateStepCounters() {
    var visible = getVisibleSteps();
    var count = visible.length;
    for (var v = 0; v < visible.length; v++) {
      var el = document.getElementById('shm-counter-' + visible[v]);
      if (el) el.textContent = 'Step ' + (v + 1) + ' of ' + count;
    }
    // Update last visible step button text
    var lastVisible = visible[visible.length - 1];
    var lastBtn = document.getElementById('shm-next-' + lastVisible);
    if (lastBtn) lastBtn.textContent = 'See My Quote';
    // Reset all other buttons to "Continue"
    for (var i = 0; i < visible.length - 1; i++) {
      var btn = document.getElementById('shm-next-' + visible[i]);
      if (btn) btn.textContent = 'Continue';
    }
  }

  function goTo(step) {
    currentStep = step;
    for (var k = 0; k < allSteps.length; k++) allSteps[k].classList.remove('active');
    if (step === 'result') {
      root.querySelector('[data-step="result"]').classList.add('active');
      progressBar.style.width = '100%';
      showResult();
    } else {
      root.querySelector('[data-step="' + step + '"]').classList.add('active');
      var visible = getVisibleSteps();
      var pos = -1;
      for (var v = 0; v < visible.length; v++) { if (visible[v] === step) { pos = v; break; } }
      progressBar.style.width = ((pos + 1) / visible.length * 100) + '%';
    }
  }

  // Option clicks
  var optionGroups = root.querySelectorAll('.shm-options');
  for (var g = 0; g < optionGroups.length; g++) {
    (function(group) {
      var key = group.getAttribute('data-key');
      var isMulti = group.classList.contains('shm-multi');
      var opts = group.querySelectorAll('.shm-opt');
      for (var o = 0; o < opts.length; o++) {
        (function(opt) {
          opt.addEventListener('click', function() {
            if (isMulti) {
              opt.classList.toggle('sel');
              var vals = [];
              var selected = group.querySelectorAll('.shm-opt.sel');
              for (var s = 0; s < selected.length; s++) vals.push(selected[s].getAttribute('data-value'));
              answers[key] = vals;
            } else {
              var allOpts = group.querySelectorAll('.shm-opt');
              for (var a = 0; a < allOpts.length; a++) allOpts[a].classList.remove('sel');
              opt.classList.add('sel');
              answers[key] = opt.getAttribute('data-value');
            }
            // When service level changes, update step counters and button text
            if (key === 'serviceLevel') updateStepCounters();
            updateToggles();
            updateButtons();
          });
        })(opts[o]);
      }
    })(optionGroups[g]);
  }

  // Toggle clicks
  var toggleRows = root.querySelectorAll('.shm-toggle-row');
  for (var t = 0; t < toggleRows.length; t++) {
    (function(row) {
      var tKey = row.getAttribute('data-toggle-key');
      row.addEventListener('click', function() {
        row.classList.toggle('sel');
        answers[tKey] = row.classList.contains('sel');
      });
    })(toggleRows[t]);
  }

  function updateToggles() {
    var smToggle = document.getElementById('shm-toggle-socialManagement');
    if (smToggle) {
      if (answers.social && answers.social !== 'none') {
        smToggle.classList.add('visible');
      } else {
        smToggle.classList.remove('visible');
        smToggle.classList.remove('sel');
        answers.socialManagement = false;
      }
    }
  }

  function updateButtons() {
    for (var i = 0; i < totalSteps; i++) {
      var btn = document.getElementById('shm-next-' + i);
      if (stepsData[i].required) btn.disabled = !answers[stepsData[i].key];
    }
  }

  // Next buttons — use skip logic
  for (var i = 0; i < totalSteps; i++) {
    (function(idx) {
      document.getElementById('shm-next-' + idx).addEventListener('click', function() {
        if (this.disabled) return;
        goTo(getNextVisible(idx));
      });
    })(i);
  }

  // Back buttons — use skip logic
  for (var i = 0; i < totalSteps; i++) {
    (function(idx) {
      document.getElementById('shm-back-' + idx).addEventListener('click', function() {
        goTo(getPrevVisible(idx));
      });
    })(i);
  }

  // ── Calculate price ───────────────────────────────────────────
  function calculatePrice() {
    var total = BASE_PRICE;
    total += PRICING.format[answers.podcastType] || 0;
    total += PRICING.podcastStyle[answers.podcastStyle] || 0;
    total += PRICING.micCount[answers.micCount] || 0;
    total += PRICING.frequency[answers.frequency] || 0;
    total += PRICING.location[answers.recordingLocation] || 0;
    if (answers.branding && answers.branding.length) {
      for (var i = 0; i < answers.branding.length; i++) total += PRICING.branding[answers.branding[i]] || 0;
    }
    total += PRICING.social[answers.social] || 0;
    if (answers.socialManagement) total += PRICING.socialManagement;
    total += PRICING.serviceLevel[answers.serviceLevel] || 0;
    if (total < MIN_PRICE) total = MIN_PRICE;
    return total;
  }

  // ── Build features list ───────────────────────────────────────
  function getFeatures() {
    var f = [];

    f.push('Professional audio editing and mastering');
    if (answers.podcastStyle === 'scripted') {
      f.push('Scripted production with sound design and narration support');
    } else {
      f.push('Multi-track editing and sound design');
    }
    f.push('Custom intros, outros, and transitions');

    // Mic count (only if answered)
    if (answers.micCount) {
      var micLabels = { solo: '1 microphone setup (host)', two: '2 microphone setup (host + 1 guest)', three: '3 microphone setup (host + 2 guests)', 'four-plus': '4+ microphone setup (host + 3+ guests)' };
      f.push(micLabels[answers.micCount]);
    }

    // Video
    if (answers.podcastType === 'video') {
      if (answers.micCount) {
        var camLabels = { solo: '1 camera setup', two: '2 camera setup', three: '3 camera setup', 'four-plus': 'Multi-camera setup (4+ cameras)' };
        f.push(camLabels[answers.micCount]);
      }
      f.push('Professional video editing and branding');
    }

    // Frequency
    var freqLabels = { weekly: 'Weekly episode production', 'every-other-week': 'Bi-weekly episode production', monthly: 'Monthly episode production', 'limited-run': 'Limited run series production' };
    f.push(freqLabels[answers.frequency]);

    // Location (only if answered)
    if (answers.recordingLocation) {
      if (answers.recordingLocation === 'studio') {
        f.push('Recording at our professional studio on Melrose Ave');
      } else if (answers.recordingLocation === 'on-location') {
        f.push('On-location recording anywhere you need');
        f.push('All equipment provided and set up on site');
        if (answers.podcastType === 'video') {
          f.push('Lighting, cameras, and microphone setup included');
          f.push('On-site producer to oversee the shoot');
        }
      } else {
        f.push('Remote / virtual recording support');
      }
    }

    // Branding
    if (answers.branding) {
      if (answers.branding.indexOf('cover-art') !== -1) f.push('Custom branding package (cover art and logo)');
      if (answers.branding.indexOf('distribution') !== -1) f.push('Distribution to all major platforms');
      if (answers.branding.indexOf('scheduling') !== -1) f.push('Booking and scheduling coordination (hosts, guests, studio)');
      if (answers.branding.indexOf('analytics') !== -1) f.push('Analytics and growth tracking');
    }

    // Social (only if answered)
    if (answers.social) {
      if (answers.social === '1-asset') {
        f.push('1 social media asset per episode');
      } else if (answers.social === '3-assets') {
        f.push('3 social media assets per episode (clips, audiograms, graphics)');
      } else if (answers.social === '7-10-assets') {
        f.push('7\u201310 social media assets per episode');
        f.push('Full content suite: reels, carousels, audiograms, and graphics');
      }
      if (answers.socialManagement && answers.social !== 'none') {
        f.push('Social media management \u2014 we schedule and post for you');
      }
    }

    // Service level
    if (answers.serviceLevel === 'full-service') {
      f.push('Full done-for-you service: recording, editing, publishing, and promotion');
      f.push('Dedicated production manager');
      f.push('Priority support');
    } else if (answers.serviceLevel === 'production-only') {
      f.push('Full recording and production \u2014 finished files delivered to you');
    } else {
      f.push('Professional editing \u2014 polished files delivered to you');
    }

    return f;
  }

  function getQuoteLabel(price) {
    if (price <= 2000) return { badge: 'Starter', name: 'Custom Starter Package' };
    if (price <= 3500) return { badge: 'Essential', name: 'Custom Essential Package' };
    if (price <= 5000) return { badge: 'Most Popular', name: 'Custom Premium Package' };
    return { badge: 'All-Inclusive', name: 'Custom Ultimate Package' };
  }

  // ── Build a human-readable summary of all quiz answers ───────
  function buildAnswerSummary() {
    var lines = [];
    var price = calculatePrice();
    var label = getQuoteLabel(price);

    lines.push('=== PODCAST QUOTE BUILDER RESULTS ===');
    lines.push('');
    lines.push('Package: ' + label.name + ' (' + label.badge + ')');
    lines.push('Estimated Price: $' + price.toLocaleString() + (answers.frequency === 'limited-run' ? '/episode' : '/month'));
    lines.push('');
    lines.push('--- Quiz Answers ---');

    // 1. Podcast Type
    var typeLabels = { audio: 'Audio Only', video: 'Audio + Video' };
    lines.push('Podcast Type: ' + (typeLabels[answers.podcastType] || answers.podcastType));

    // 2. Podcast Style
    var styleLabels = { conversational: 'Conversational', scripted: 'Scripted / Journalistic', monologue: 'Essay / Monologue' };
    lines.push('Podcast Style: ' + (styleLabels[answers.podcastStyle] || answers.podcastStyle));

    // 3. Service Level
    var serviceLabels = { 'editing-only': 'Editing Only', 'production-only': 'Production Only', 'full-service': 'Full Service — Done for You' };
    lines.push('Service Level: ' + (serviceLabels[answers.serviceLevel] || answers.serviceLevel));

    // 4. Mic Count (if answered)
    if (answers.micCount) {
      var micLabels = { solo: 'Just the Host (1 mic)', two: 'Host + 1 Guest (2 mics)', three: 'Host + 2 Guests (3 mics)', 'four-plus': 'Host + 3+ Guests (4+ mics)' };
      lines.push('People on Mic: ' + (micLabels[answers.micCount] || answers.micCount));
    }

    // 5. Frequency
    var freqLabels = { weekly: 'Weekly', 'every-other-week': 'Every Other Week', monthly: 'Once a Month', 'limited-run': 'Limited Run Series' };
    lines.push('Release Frequency: ' + (freqLabels[answers.frequency] || answers.frequency));

    // 6. Recording Location (if answered)
    if (answers.recordingLocation) {
      var locLabels = { virtual: 'Virtual / Remote', studio: 'In Our Studio', 'on-location': 'On-Location' };
      lines.push('Recording Location: ' + (locLabels[answers.recordingLocation] || answers.recordingLocation));
    }

    // 7. Branding selections
    if (answers.branding && answers.branding.length) {
      var brandLabels = { 'cover-art': 'Custom Branding Package', distribution: 'Distribution to All Major Platforms', scheduling: 'Booking & Scheduling Coordination', analytics: 'Analytics & Growth Tracking' };
      var brandItems = [];
      for (var i = 0; i < answers.branding.length; i++) {
        brandItems.push(brandLabels[answers.branding[i]] || answers.branding[i]);
      }
      lines.push('Branding & Distribution: ' + brandItems.join(', '));
    } else {
      lines.push('Branding & Distribution: None selected');
    }

    // 8. Social media
    if (answers.social) {
      var socialLabels = { none: 'No Social Media Content', '1-asset': '1 Asset per Episode', '3-assets': '3 Assets per Episode', '7-10-assets': '7–10 Assets per Episode' };
      lines.push('Social Media Content: ' + (socialLabels[answers.social] || answers.social));
      if (answers.socialManagement && answers.social !== 'none') {
        lines.push('Social Media Management: Yes — schedule and post to accounts');
      }
    }

    lines.push('');
    lines.push('--- What\'s Included ---');
    var features = getFeatures();
    for (var i = 0; i < features.length; i++) {
      lines.push('• ' + features[i]);
    }

    return lines.join('\n');
  }

  // ── Build Calendly URL with prefilled quiz data ────────────
  function buildCalendlyUrl() {
    var summary = buildAnswerSummary();
    // Calendly supports a1, a2, etc. for custom question answers
    // We put the full summary in a1 (set up a custom text question in Calendly)
    var url = CALENDLY_URL + '?a1=' + encodeURIComponent(summary);
    return url;
  }

  // ── Load Calendly widget script ────────────────────────────
  function loadCalendlyWidget(callback) {
    if (window.Calendly) { callback(); return; }
    var link = document.createElement('link');
    link.href = 'https://assets.calendly.com/assets/external/widget.css';
    link.rel = 'stylesheet';
    document.head.appendChild(link);
    var script = document.createElement('script');
    script.src = 'https://assets.calendly.com/assets/external/widget.js';
    script.onload = callback;
    document.head.appendChild(script);
  }

  function showResult() {
    var price = calculatePrice();
    var label = getQuoteLabel(price);
    document.getElementById('shm-badge').textContent = label.badge;
    document.getElementById('shm-pkg-name').textContent = label.name;
    document.getElementById('shm-pkg-price').textContent = '$' + price.toLocaleString();
    var periodEl = document.getElementById('shm-period');
    if (answers.frequency === 'limited-run') {
      periodEl.textContent = 'per episode';
    } else {
      periodEl.textContent = 'per month';
    }
    var features = getFeatures();
    var fhtml = '';
    for (var i = 0; i < features.length; i++) {
      fhtml += '<div class="shm-feat"><div class="shm-feat-chk">' + CHK + '</div><span>' + features[i] + '</span></div>';
    }
    document.getElementById('shm-feat-list').innerHTML = fhtml;

    // Preload Calendly widget
    loadCalendlyWidget(function() {});

    document.getElementById('shm-cta').onclick = function() {
      var summary = buildAnswerSummary();
      // Try Calendly popup first, fall back to direct link
      if (window.Calendly) {
        window.Calendly.initPopupWidget({
          url: CALENDLY_URL + '?hide_gdpr_banner=1',
          prefill: {
            customAnswers: {
              a1: summary
            }
          }
        });
      } else {
        window.open(buildCalendlyUrl(), '_blank');
      }
    };
  }

  document.getElementById('shm-restart').addEventListener('click', function() {
    answers = {};
    var allOpts = root.querySelectorAll('.shm-opt');
    for (var i = 0; i < allOpts.length; i++) allOpts[i].classList.remove('sel');
    var allToggles = root.querySelectorAll('.shm-toggle-row');
    for (var i = 0; i < allToggles.length; i++) {
      allToggles[i].classList.remove('sel');
      allToggles[i].classList.remove('visible');
    }
    updateButtons();
    updateStepCounters();
    goTo(0);
  });

  updateButtons();
  updateStepCounters();
})();
