// Chicko Analytics Dashboard
// © 2026 System360 by Alex Melnikov. All rights reserved.
// Proprietary software — unauthorized copying or distribution prohibited.
//
// v6_likeforlike: Фаза 1.3 — like-for-like сравнения по дням недели.
//   - Загружаются профили сети и ресторана по dow за 90 дней
//   - renderKPIs показывает 3 сравнения: vs моя норма / медиана сети / топ-25%
//   - renderAlerts и renderInsights используют like-for-like базу
//   - #70 закрыт бонусом: отклонения теперь во всех 6 KPI-карточках

export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Chicko Analytics</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
<style>
:root{
  --bg:#151E2E;--bg2:#1C2840;--card:#1E2D47;--card2:#243352;
  --border:#2E4068;--border2:#3A5080;
  --gold:#D4A84B;--gold2:#F0C96A;--gold3:#FDE9B0;
  --text:#EBF0FA;--text2:#8AAACE;--text3:#4E6A90;
  --green:#2ECC71;--green2:#27AE60;
  --amber:#F39C12;--red:#E74C3C;
  --teal:#1ABC9C;--blue:#4A9EF5;--purple:#9B59B6;
}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--text);font-family:'Inter',sans-serif;font-size:13px;min-height:100vh;overflow-x:hidden}

/* HEADER */
.hdr{background:var(--bg2);border-bottom:1px solid var(--border);padding:0 20px;position:sticky;top:0;z-index:200;box-shadow:0 2px 16px rgba(0,0,0,.3)}
.hdr-in{max-width:1440px;margin:0 auto;display:flex;align-items:center;gap:14px;height:56px}
.logo{font-family:'Cormorant Garamond',serif;font-size:19px;font-weight:700;color:var(--gold);letter-spacing:2px;text-transform:uppercase;flex-shrink:0;line-height:1}
.logo small{display:block;font-family:'Inter',sans-serif;font-size:8px;color:var(--text3);letter-spacing:1.5px;font-weight:400;margin-top:1px}
.sel-wrap{flex:1;max-width:360px;position:relative}
.sel-wrap::after{content:'▾';position:absolute;right:10px;top:50%;transform:translateY(-50%);color:var(--gold);pointer-events:none;font-size:12px}
.main-sel{width:100%;background:var(--card);border:1px solid var(--border2);color:var(--text);padding:7px 28px 7px 12px;border-radius:8px;font-family:'Inter',sans-serif;font-size:12px;appearance:none;cursor:pointer}
.main-sel:focus{outline:none;border-color:var(--gold)}

/* CALENDAR PICKER */
.cal-picker-wrap{position:relative;flex-shrink:0}
.cal-btn{display:flex;align-items:center;gap:7px;background:var(--card);border:1px solid var(--border2);color:var(--text);padding:7px 13px;border-radius:8px;cursor:pointer;font-family:'Inter',sans-serif;font-size:11px;transition:border-color .2s;white-space:nowrap}
.cal-btn:hover,.cal-btn.active{border-color:var(--gold);color:var(--gold2)}
.cal-btn .ico{color:var(--gold);font-size:13px}
.cal-dropdown{position:absolute;top:calc(100% + 6px);left:0;background:var(--card2);border:1px solid var(--border2);border-radius:12px;padding:14px;z-index:300;box-shadow:0 8px 32px rgba(0,0,0,.5);min-width:280px;display:none}
.cal-dropdown.open{display:block}
.cal-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.cal-month-lbl{font-size:12px;font-weight:600;color:var(--text)}
.cal-nav{background:none;border:none;color:var(--text2);cursor:pointer;padding:2px 6px;font-size:14px}
.cal-nav:hover{color:var(--text)}
.cal-dow-row{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;margin-bottom:4px}
.cal-dow{text-align:center;font-size:9px;color:var(--text3);padding:3px;font-weight:600;text-transform:uppercase}
.cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}
.cal-day{text-align:center;padding:6px 4px;border-radius:6px;font-size:11px;cursor:pointer;transition:all .15s;color:var(--text2)}
.cal-day.has-data{color:var(--text);background:rgba(74,158,245,.1)}
.cal-day.has-data:hover{background:rgba(212,168,75,.2);color:var(--gold)}
.cal-day.in-range{background:rgba(212,168,75,.12);color:var(--gold2)}
.cal-day.range-start,.cal-day.range-end{background:var(--gold);color:#000;font-weight:700}
.cal-day.empty{cursor:default;opacity:0}
.cal-day.no-data{opacity:.25;cursor:not-allowed}
.cal-presets{display:flex;gap:5px;margin-top:10px;flex-wrap:wrap}
.cal-preset{padding:4px 9px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--text2);font-size:10px;cursor:pointer;font-family:'Inter',sans-serif}
.cal-preset:hover{border-color:var(--gold);color:var(--gold)}
.cal-apply{width:100%;margin-top:10px;padding:7px;background:var(--gold);color:#000;border:none;border-radius:7px;font-family:'Inter',sans-serif;font-size:11px;font-weight:600;cursor:pointer}
.cal-apply:hover{background:var(--gold2)}

.score-chip{display:flex;align-items:center;gap:10px;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:5px 14px;white-space:nowrap}
.chip-num{font-family:'Cormorant Garamond',serif;font-size:22px;font-weight:700;color:var(--gold);line-height:1}
.chip-lbl{font-size:9px;color:var(--text2);text-transform:uppercase;letter-spacing:1px}
.chip-grade{font-size:11px;font-weight:600}

/* NAV */
.nav{background:var(--card);border-bottom:1px solid var(--border);padding:0 20px;position:sticky;top:56px;z-index:99}
.nav-in{max-width:1440px;margin:0 auto;display:flex}
.ntab{padding:11px 18px;color:var(--text2);font-size:11px;cursor:pointer;border-bottom:2px solid transparent;transition:all .2s;user-select:none;white-space:nowrap;font-weight:500}
.ntab:hover{color:var(--text)}
.ntab.active{color:var(--gold);border-bottom-color:var(--gold)}

/* MAIN */
.main{max-width:1440px;margin:0 auto;padding:18px 20px}
.panel{display:none}.panel.active{display:block}

/* CARDS */
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px 18px;position:relative;overflow:hidden}
.card:hover{border-color:var(--border2)}
.ctitle{font-size:10px;color:var(--text2);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:12px;display:flex;align-items:center;gap:7px;font-weight:600}

/* GRIDS */
.g5{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:12px}
.g4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:12px}
.g3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:12px}
.g2{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:12px}
.g21{display:grid;grid-template-columns:2fr 1fr;gap:12px;margin-bottom:12px}

/* KPI */
.kcard{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px 16px;position:relative;overflow:hidden;transition:border-color .2s}
.kcard:hover{border-color:var(--border2)}
.klbl{font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1.2px;margin-bottom:4px;font-weight:600}
.kval{font-family:'Cormorant Garamond',serif;font-size:28px;font-weight:700;color:var(--text);line-height:1;margin-bottom:4px}
.kval .u{font-size:13px;color:var(--text2);font-family:'Inter',sans-serif;font-weight:400}
.kdelta{font-size:10px;display:flex;align-items:center;gap:4px;min-height:14px}
.kbench{font-size:10px;color:var(--text3);margin-top:1px}
.kbar{position:absolute;bottom:0;left:0;height:3px;border-radius:0 0 12px 12px;transition:width .7s ease}
.bg{background:linear-gradient(90deg,var(--green2),var(--green))}
.ba{background:linear-gradient(90deg,#c87f0a,var(--amber))}
.br{background:linear-gradient(90deg,#c0392b,var(--red))}
.bgo{background:linear-gradient(90deg,var(--gold),var(--gold2))}
.bb{background:linear-gradient(90deg,#2980b9,var(--blue))}
.up{color:var(--green)}.dn{color:var(--red)}.nt{color:var(--text2)}

/* PERIOD ROW */
.prow{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px}
.pgroup{display:flex;gap:4px}
.pbtn{padding:5px 11px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--text2);font-family:'Inter',sans-serif;font-size:10px;cursor:pointer;transition:all .15s;font-weight:500}
.pbtn:hover{border-color:var(--border2);color:var(--text)}
.pbtn.active{background:rgba(212,168,75,.18);border-color:var(--gold);color:var(--gold)}

/* METRIC TOGGLE */
.mtbtn{padding:4px 10px;border-radius:20px;border:1px solid var(--border);background:transparent;color:var(--text2);font-size:10px;cursor:pointer;transition:all .15s;white-space:nowrap;font-weight:500}
.mtbtn.active{background:var(--gold);color:#000;border-color:var(--gold);font-weight:600}
.mrow{display:flex;gap:5px;margin-bottom:10px;flex-wrap:wrap}

/* ALERTS */
.alert{padding:9px 14px;border-radius:8px;font-size:11px;margin-bottom:8px;display:flex;align-items:flex-start;gap:8px;line-height:1.5;font-weight:400}
.alert b{font-weight:600}
.a-red{background:rgba(231,76,60,.12);border:1px solid rgba(231,76,60,.3);color:#f4a49e}
.a-amber{background:rgba(243,156,18,.12);border:1px solid rgba(243,156,18,.3);color:#f8cd7a}
.a-green{background:rgba(46,204,113,.12);border:1px solid rgba(46,204,113,.3);color:#82e0aa}
.a-blue{background:rgba(74,158,245,.12);border:1px solid rgba(74,158,245,.3);color:#9ec8f7}

/* SCORE */
.score-ring{position:relative;width:144px;height:144px}
.score-ring canvas{position:absolute;top:0;left:0}
.score-ctr{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center}
.score-n{font-family:'Cormorant Garamond',serif;font-size:46px;font-weight:700;color:var(--gold);line-height:1}
.score-g{font-size:12px;font-weight:600;text-align:center;margin-top:2px}
.score-p{font-size:10px;color:var(--text2);text-align:center}
.sbr-row{display:flex;align-items:center;gap:8px;font-size:10px}
.sbr-lbl{color:var(--text2);flex:1}
.sbr-t{flex:2;height:4px;background:var(--border);border-radius:2px;overflow:hidden}
.sbr-f{height:100%;border-radius:2px;transition:width .8s}
.sbr-v{width:32px;text-align:right;color:var(--text3)}

/* COMPARE SLOTS */
.comp-area{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap}
.comp-slot{min-width:170px;flex:1;max-width:220px}
.comp-lbl{font-size:9px;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;font-weight:600}
.comp-sel{width:100%;background:var(--card2);border:1px solid var(--border);color:var(--text);padding:7px 10px;border-radius:8px;font-family:'Inter',sans-serif;font-size:10px;appearance:none;cursor:pointer}
.comp-sel:focus{outline:none;border-color:var(--teal)}

/* TABLES */
.ctbl{width:100%;border-collapse:collapse;font-size:11px}
.ctbl th{text-align:left;padding:8px 10px;color:var(--text2);font-size:9px;text-transform:uppercase;letter-spacing:1px;border-bottom:1px solid var(--border);font-weight:600;white-space:nowrap}
.ctbl td{padding:8px 10px;border-bottom:1px solid rgba(46,64,104,.4);transition:background .1s}
.ctbl tr:hover td{background:rgba(255,255,255,.02)}
.ctbl tr:last-child td{border:none}
.c-m{color:var(--text2);font-size:10px}.c-s{color:var(--gold);font-weight:600}.c-n{color:var(--text2)}.c-t{color:var(--gold2)}
.tag-u{color:var(--green);font-size:10px;font-weight:600}.tag-d{color:var(--red);font-size:10px;font-weight:600}

/* DOW */
.dow-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:8px;margin-bottom:14px}
.dow-card{background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:10px 6px;text-align:center}
.dow-card.weekend{border-color:rgba(212,168,75,.35);background:rgba(212,168,75,.06)}
.dow-card.best{border-color:var(--green2);background:rgba(46,204,113,.08)}
.dow-card.worst{border-color:var(--red);background:rgba(231,76,60,.08)}
.dow-name{font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;font-weight:600;margin-bottom:6px}
.dow-rev{font-family:'Cormorant Garamond',serif;font-size:18px;font-weight:700;color:var(--text);line-height:1}
.dow-chk{font-size:9px;color:var(--text2);margin-top:3px}
.dow-badge{font-size:8px;padding:1px 6px;border-radius:10px;margin-top:4px;display:inline-block}
.badge-we{background:rgba(212,168,75,.2);color:var(--gold)}
.badge-wd{background:rgba(74,158,245,.2);color:var(--blue)}

/* SLIDERS */
.sl-row{margin-bottom:14px}
.sl-hdr{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px}
.sl-name{font-size:11px;color:var(--text2);font-weight:500}
.sl-val{font-family:'Cormorant Garamond',serif;font-size:19px;color:var(--gold);font-weight:700}
.sl-unit{font-size:10px;color:var(--text2)}
input[type=range]{-webkit-appearance:none;width:100%;height:4px;background:var(--border);border-radius:2px;outline:none}
input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:15px;height:15px;border-radius:50%;background:var(--gold);cursor:pointer;border:2px solid var(--bg);box-shadow:0 0 6px rgba(212,168,75,.4)}

/* P&L */
.pl-r{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid rgba(46,64,104,.5)}
.pl-r:last-child{border:none}
.pl-lbl{font-size:11px;color:var(--text2)}
.pl-amt{font-family:'Cormorant Garamond',serif;font-size:17px;font-weight:700}
.pl-tot{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-top:2px solid var(--gold);margin-top:4px}
.pl-tot-lbl{font-size:13px;font-weight:600}
.pl-tot-amt{font-family:'Cormorant Garamond',serif;font-size:28px;font-weight:700}

/* FORECAST */
.fc-compare{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px}
.fc-box{border-radius:10px;padding:14px 16px}
.fc-box.current{background:rgba(74,158,245,.08);border:1px solid rgba(74,158,245,.25)}
.fc-box.adjusted{background:rgba(212,168,75,.08);border:1px solid rgba(212,168,75,.25)}
.fc-box-title{font-size:10px;color:var(--text2);text-transform:uppercase;letter-spacing:1px;font-weight:600;margin-bottom:8px}
.fc-metric{display:flex;justify-content:space-between;padding:3px 0;font-size:11px}
.fc-big{font-family:'Cormorant Garamond',serif;font-size:26px;font-weight:700;margin:8px 0 4px}
.fc-sub{font-size:10px;color:var(--text2)}

/* WEEKDAY BREAKDOWN */
.wdb-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px}
.wdb-box{border-radius:10px;padding:14px}
.wdb-box.wd{background:rgba(74,158,245,.08);border:1px solid rgba(74,158,245,.2)}
.wdb-box.we{background:rgba(212,168,75,.08);border:1px solid rgba(212,168,75,.2)}
.wdb-t{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px}
.wdb-rev{font-family:'Cormorant Garamond',serif;font-size:28px;font-weight:700;line-height:1;margin-bottom:4px}
.wdb-row{display:flex;justify-content:space-between;font-size:10px;padding:2px 0;color:var(--text2)}

/* RANK */
.rbar-row{display:flex;align-items:center;gap:8px;padding:3px 2px;border-radius:6px}
.rbar-row.me{background:rgba(212,168,75,.06)}
.rbar-name{width:175px;font-size:9px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.rbar-name.me{color:var(--gold);font-weight:600}
.rbar-t{flex:1;height:7px;background:var(--border);border-radius:4px;overflow:hidden}
.rbar-f{height:100%;border-radius:4px}
.rbar-v{width:70px;text-align:right;font-size:9px;color:var(--text)}

/* ROADMAP */
.rm-q{margin-bottom:16px}
.rm-q-hdr{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.rm-q-lbl{font-size:11px;font-weight:600;padding:3px 10px;border-radius:20px}
.rm-q-lbl.done{background:rgba(46,204,113,.2);color:var(--green)}
.rm-q-lbl.current{background:rgba(212,168,75,.2);color:var(--gold)}
.rm-q-lbl.next{background:rgba(74,158,245,.15);color:var(--blue)}
.rm-q-lbl.future{background:rgba(78,106,144,.15);color:var(--text2)}
.rm-items{display:flex;flex-direction:column;gap:6px;padding-left:20px}
.rm-item{display:flex;align-items:flex-start;gap:8px;font-size:11px;color:var(--text2)}
.rm-item.done{color:var(--text)}
.rm-ico{flex-shrink:0;width:16px;text-align:center;font-size:12px}

/* CASE */
.case-card{background:var(--card2);border:1px solid var(--border);border-radius:12px;padding:18px;margin-bottom:12px}
.case-header{display:flex;align-items:center;gap:12px;margin-bottom:10px}
.case-num{font-family:'Cormorant Garamond',serif;font-size:24px;font-weight:700;color:var(--gold);flex-shrink:0}
.case-title{font-size:13px;font-weight:600;color:var(--text)}
.case-sub{font-size:10px;color:var(--text2);margin-top:1px}
.case-body{font-size:11px;color:var(--text2);line-height:1.7;margin-bottom:10px}
.case-results{display:flex;gap:12px;flex-wrap:wrap}
.case-kpi{text-align:center;padding:8px 14px;background:rgba(212,168,75,.08);border:1px solid rgba(212,168,75,.2);border-radius:8px}
.case-kpi-v{font-family:'Cormorant Garamond',serif;font-size:20px;font-weight:700;color:var(--gold)}
.case-kpi-l{font-size:9px;color:var(--text2);text-transform:uppercase;letter-spacing:.5px}

/* INSIGHTS */
.ins-card{background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:14px;border-left:3px solid var(--border);transition:transform .2s}
.ins-card:hover{transform:translateX(3px)}
.ins-card.red{border-left-color:var(--red)}
.ins-card.amber{border-left-color:var(--amber)}
.ins-card.green{border-left-color:var(--green2)}
.ins-card.blue{border-left-color:var(--blue)}
.ins-t{font-size:11px;font-weight:600;color:var(--text);margin-bottom:5px;display:flex;align-items:center;gap:6px}
.ins-b{font-size:10px;color:var(--text2);line-height:1.6}
.ins-a{display:inline-block;margin-top:8px;padding:4px 10px;background:rgba(212,168,75,.12);border:1px solid rgba(212,168,75,.25);border-radius:16px;color:var(--gold);font-size:9px;cursor:pointer}

/* DONUT */
.dl-row{display:flex;align-items:center;gap:8px;padding:3px 0}
.dl-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0}
.dl-name{flex:1;font-size:10px;color:var(--text2)}
.dl-pct{font-weight:600;font-size:10px}
.dl-val{font-size:9px;color:var(--text3);margin-left:2px}

/* GAUGE */
.gauge-w{width:200px;margin:6px auto 0;display:block}
.gauge-w canvas{display:block}
.gauge-m{position:absolute;top:68px;left:50%;transform:translateX(-50%);text-align:center;width:100%;pointer-events:none}
.gauge-n{font-family:'Cormorant Garamond',serif;font-size:24px;font-weight:700;line-height:1}

/* LOCKED */
.lock-card{position:relative;overflow:hidden;border-color:rgba(26,188,156,.2)!important}
.lock-over{position:absolute;inset:0;background:rgba(21,30,46,.86);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;backdrop-filter:blur(2px);z-index:10}
.lock-ico{font-size:28px;opacity:.7}
.lock-t{font-size:13px;color:var(--teal);font-weight:600}
.lock-d{font-size:11px;color:var(--text2);text-align:center;max-width:200px;line-height:1.5}
.lock-chip{padding:4px 12px;background:rgba(26,188,156,.12);border:1px solid rgba(26,188,156,.3);border-radius:20px;color:var(--teal);font-size:9px;font-weight:600;letter-spacing:.5px}
.lock-prev{opacity:.1;filter:blur(1px);pointer-events:none}

@media(max-width:900px){.g5,.g4{grid-template-columns:repeat(2,1fr)}.g3{grid-template-columns:1fr 1fr}.g21{grid-template-columns:1fr}.dow-grid{grid-template-columns:repeat(4,1fr)}.score-chip{display:none}.fc-compare,.wdb-grid{grid-template-columns:1fr}}
@media(max-width:600px){.g5,.g4,.g3,.g2{grid-template-columns:1fr 1fr}.main{padding:10px}.dow-grid{grid-template-columns:repeat(3,1fr)}}

.period-panel{display:flex;align-items:center;gap:12px;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:9px 16px;margin-bottom:12px;flex-wrap:wrap}
.plbl{font-size:10px;color:var(--text2);letter-spacing:.5px;font-weight:600;white-space:nowrap;margin-right:2px}
.pbtns2{display:flex;gap:4px}
.pbtn2{padding:4px 11px;border-radius:6px;border:1px solid var(--border);background:transparent;color:var(--text2);font-size:11px;cursor:pointer;font-family:'Inter',sans-serif;transition:all .15s;white-space:nowrap}
.pbtn2:hover{border-color:var(--gold);color:var(--gold2)}
.pbtn2.active{background:var(--gold);color:#000;border-color:var(--gold);font-weight:600}
.psep{width:1px;height:20px;background:var(--border);align-self:center}
.pdesc{font-size:10px;color:var(--text3);margin-left:auto;white-space:nowrap}

/* SEARCHABLE SELECTOR */
.sel-wrap{flex:1;max-width:400px;position:relative}
.sel-input-wrap{position:relative;display:flex;align-items:center}
.sel-search{width:100%;background:var(--card);border:1px solid var(--border2);color:var(--text);padding:7px 32px 7px 12px;border-radius:8px;font-family:'Inter',sans-serif;font-size:12px;cursor:pointer;outline:none}
.sel-search:focus{border-color:var(--gold)}
.sel-search::placeholder{color:var(--text3)}
.sel-arrow{position:absolute;right:10px;color:var(--gold);pointer-events:none;font-size:11px}
.sel-dropdown{position:absolute;top:calc(100% + 4px);left:0;right:0;background:var(--card2);border:1px solid var(--border2);border-radius:10px;z-index:500;box-shadow:0 8px 24px rgba(0,0,0,.4);display:none;max-height:320px;overflow:hidden;flex-direction:column}
.sel-dropdown.open{display:flex}
.sel-list{overflow-y:auto;flex:1}
.sel-item{padding:8px 14px;font-size:12px;color:var(--text2);cursor:pointer;display:flex;justify-content:space-between;gap:8px}
.sel-item:hover{background:rgba(212,168,75,.08);color:var(--text)}
.sel-item.active{color:var(--gold);background:rgba(212,168,75,.1)}
.sel-item .sel-city{font-size:10px;color:var(--text3)}
.sel-count{font-size:10px;color:var(--text3);padding:6px 14px;border-top:1px solid var(--border)}


/* LOGIN SCREEN */
#login-screen{position:fixed;inset:0;background:var(--bg);display:flex;align-items:center;justify-content:center;z-index:10000;font-family:'Inter',sans-serif;padding:20px}
#login-screen.hidden{display:none}
.login-card{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:36px 32px;max-width:420px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.5)}
.login-logo{font-family:'Cormorant Garamond',serif;font-size:28px;font-weight:700;color:var(--gold);letter-spacing:2px;text-align:center;margin-bottom:4px}
.login-logo small{display:block;font-family:'Inter',sans-serif;font-size:10px;color:var(--text3);letter-spacing:1.5px;font-weight:400;margin-top:4px}
.login-title{color:var(--text);font-size:16px;font-weight:600;text-align:center;margin:28px 0 6px}
.login-sub{color:var(--text2);font-size:12px;text-align:center;margin-bottom:24px;line-height:1.5}
.login-form{display:flex;flex-direction:column;gap:12px}
.login-input{background:var(--card2);border:1px solid var(--border2);color:var(--text);padding:12px 14px;border-radius:10px;font-family:'Inter',sans-serif;font-size:14px;outline:none;transition:border-color .2s}
.login-input:focus{border-color:var(--gold)}
.login-btn{background:var(--gold);color:#000;border:none;padding:12px;border-radius:10px;font-family:'Inter',sans-serif;font-size:13px;font-weight:600;cursor:pointer;transition:background .2s}
.login-btn:hover{background:var(--gold2)}
.login-btn:disabled{background:var(--border2);color:var(--text3);cursor:not-allowed}
.login-msg{font-size:12px;text-align:center;min-height:16px;margin-top:4px}
.login-msg.success{color:var(--green)}
.login-msg.error{color:var(--red)}
.login-msg.info{color:var(--text2)}

/* FEEDBACK */
.fb-float{position:fixed;bottom:24px;right:24px;z-index:500;width:48px;height:48px;border-radius:50%;background:var(--gold);color:#000;border:none;cursor:pointer;font-size:20px;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(0,0,0,.4);transition:transform .2s,background .2s}
.fb-float:hover{transform:scale(1.1);background:var(--gold2)}
.fb-overlay{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:600;display:none;align-items:center;justify-content:center}
.fb-overlay.open{display:flex}
.fb-modal{background:var(--card);border:1px solid var(--border2);border-radius:16px;padding:24px;width:90%;max-width:420px;box-shadow:0 12px 48px rgba(0,0,0,.6)}
.fb-title{font-family:'Cormorant Garamond',serif;font-size:20px;font-weight:700;color:var(--gold);margin-bottom:16px}
.fb-cats{display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap}
.fb-cat{padding:6px 12px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text2);font-size:11px;cursor:pointer;font-family:'Inter',sans-serif;transition:all .15s}
.fb-cat:hover{border-color:var(--gold);color:var(--gold)}
.fb-cat.sel{background:var(--gold);color:#000;border-color:var(--gold);font-weight:600}
.fb-text{width:100%;background:var(--bg2);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:'Inter',sans-serif;font-size:12px;padding:10px;min-height:80px;resize:vertical;margin-bottom:12px}
.fb-text::placeholder{color:var(--text3)}
.fb-text:focus{outline:none;border-color:var(--gold)}
.fb-meta{font-size:10px;color:var(--text3);margin-bottom:14px}
.fb-actions{display:flex;gap:8px;justify-content:flex-end}
.fb-send{padding:8px 20px;background:var(--gold);color:#000;border:none;border-radius:8px;font-family:'Inter',sans-serif;font-size:12px;font-weight:600;cursor:pointer}
.fb-send:hover{background:var(--gold2)}
.fb-send:disabled{background:var(--border2);color:var(--text3);cursor:not-allowed}
.fb-cancel{padding:8px 16px;background:transparent;border:1px solid var(--border);color:var(--text2);border-radius:8px;font-family:'Inter',sans-serif;font-size:12px;cursor:pointer}
.fb-cancel:hover{border-color:var(--text2);color:var(--text)}
.fb-ok{color:var(--green);font-size:12px;text-align:center;margin-top:8px;display:none}

/* FORECAST */
.fc-block{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:16px 18px;margin-bottom:12px}
.fc-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
.fc-hdr-left{display:flex;align-items:center;gap:8px}
.fc-lbl{font-size:10px;color:var(--text2);text-transform:uppercase;letter-spacing:1.5px;font-weight:600}
.fc-sub{font-size:10px;color:var(--text3)}
.fc-toggle{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text2);cursor:pointer;user-select:none}
.fc-toggle input{accent-color:var(--gold);cursor:pointer}
.fc-row{display:grid;grid-template-columns:2fr 1fr;gap:12px;margin-bottom:12px}
.fc-big{font-family:'Cormorant Garamond',serif;font-size:30px;font-weight:700;color:var(--gold);line-height:1}
.fc-pair{display:flex;gap:16px;margin-top:8px}
.fc-pair-item .fc-pair-lbl{font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px}
.fc-pair-item .fc-pair-val{font-family:'Cormorant Garamond',serif;font-size:17px;font-weight:700;line-height:1.2}
.fc-side{display:flex;flex-direction:column;gap:8px}
.fc-side-card{background:var(--card2);border:1px solid var(--border);border-radius:10px;padding:10px 12px;flex:1}
.fc-pbar{background:var(--bg2);border-radius:4px;height:5px;margin-top:5px;overflow:hidden}
.fc-pbar-fill{height:100%;border-radius:4px;transition:width .5s ease}
.fc-chart{display:flex;gap:1px;align-items:flex-end;height:50px}
.fc-chart-bar{flex:1;border-radius:2px 2px 0 0;min-width:2px;transition:height .3s}
.fc-chart-lbl{display:flex;justify-content:space-between;margin-top:3px;font-size:9px;color:var(--text3)}
.fc-method{font-size:9px;color:var(--text3);margin-top:6px;font-style:italic}

</style>
</head>
<body>
<div id="login-screen" class="hidden">
  <div class="login-card">
    <div class="login-logo">CHICKO<small>ANALYTICS</small></div>
    <div class="login-title">Вход в дашборд</div>
    <div class="login-sub">Введите ваш email — мы отправим ссылку для входа.<br>Ссылка действительна 15 минут.</div>
    <form class="login-form" id="loginForm">
      <input type="email" class="login-input" id="loginEmail" placeholder="email@example.com" required autocomplete="email">
      <button type="submit" class="login-btn" id="loginBtn">Получить ссылку</button>
      <div class="login-msg" id="loginMsg"></div>
    </form>
  </div>
</div>


<!-- HEADER -->
<div class="hdr">
  <div class="hdr-in">
    <div class="logo">CHICKO<small>Analytics Dashboard</small></div>
    <div class="sel-wrap" id="selWrap">
      <div class="sel-input-wrap">
        <input class="sel-search" id="selSearch" placeholder="Выбрать ресторан..." readonly
          onclick="toggleSelDropdown()" oninput="filterSel(this.value)" autocomplete="off">
        <span class="sel-arrow">▾</span>
      </div>
      <div class="sel-dropdown" id="selDropdown">
        <div style="padding:8px 10px 4px">
          <input id="selFilter" placeholder="🔍 Поиск по названию, городу..." 
            style="width:100%;background:var(--card);border:1px solid var(--border);color:var(--text);padding:6px 10px;border-radius:6px;font-family:Inter,sans-serif;font-size:11px;outline:none"
            oninput="filterSel(this.value)">
        </div>
        <div class="sel-list" id="selList"></div>
        <div class="sel-count" id="selCount"></div>
      </div>
      <select id="mainSel" style="display:none"></select>
    </div>
    <label id="netToggle" style="display:flex;align-items:center;gap:5px;cursor:pointer;user-select:none;flex-shrink:0">
      <input type="checkbox" id="netCb" onchange="toggleNetworkView(this.checked)" style="accent-color:var(--gold);cursor:pointer">
      <span style="font-size:11px;color:var(--text2);white-space:nowrap">Вся сеть</span>
    </label>
    <!-- Global Calendar Picker -->
    <div class="cal-picker-wrap" id="globalCalWrap">
      <button class="cal-btn" id="globalCalBtn" onclick="toggleCal('global',event)">
        <span class="ico">📅</span>
        <span id="globalCalLbl">01 апр — 15 апр</span>
      </button>
      <div class="cal-dropdown" id="globalCalDrop"></div>
    </div>
  </div>
</div>

<!-- NAV -->
<div class="nav">
  <div class="nav-in">
    <div class="ntab active" data-tab="overview"  onclick="goTab(this)">📊 Обзор</div>
    <div class="ntab"        data-tab="dynamics"  onclick="goTab(this)">📈 Динамика</div>
    <div class="ntab"        data-tab="compare"   onclick="goTab(this)">⚡ Сравнение</div>
    <div class="ntab"        data-tab="analysis"  onclick="goTab(this)">🧮 Анализ</div>
    <!-- dev tab hidden for users -->
  </div>
</div>

<div class="main">

<!-- ══ OVERVIEW ══ -->
<div class="panel active" id="p-overview">

  <div id="forecastBox"></div>
  <div id="alertsBox"></div>
  <div>
    <div>
      <div class="g3" style="margin-bottom:10px">
        <div class="kcard"><div class="klbl">Выручка / день</div><div class="kval" id="kv-rev">—</div><div class="kdelta" id="kd-rev"></div><div class="kbench" id="kb-rev"></div><div class="kbar bgo" id="kr-rev" style="width:0"></div></div>
        <div class="kcard"><div class="klbl">Средний чек</div><div class="kval" id="kv-chk">—</div><div class="kdelta" id="kd-chk"></div><div class="kbench" id="kb-chk"></div><div class="kbar bb" id="kr-chk" style="width:0"></div></div>
        <div class="kcard"><div class="klbl">Чеков / день</div><div class="kval" id="kv-cnt">—</div><div class="kdelta" id="kd-cnt"></div><div class="kbench" id="kb-cnt"></div><div class="kbar bb" id="kr-cnt" style="width:0"></div></div>
      </div>
      <div class="g3">
        <div class="kcard"><div class="klbl">Фудкост %</div><div class="kval" id="kv-fc">—</div><div class="kdelta" id="kd-fc"></div><div class="kbench" id="kb-fc"></div><div class="kbar" id="kr-fc" style="width:0"></div></div>
        <div class="kcard"><div class="klbl">Скидки %</div><div class="kval" id="kv-disc">—</div><div class="kdelta" id="kd-disc"></div><div class="kbench" id="kb-disc"></div><div class="kbar" id="kr-disc" style="width:0"></div></div>
        <div class="kcard"><div class="klbl">Доставка %</div><div class="kval" id="kv-del">—</div><div class="kdelta" id="kd-del"></div><div class="kbench" id="kb-del"></div><div class="kbar bg" id="kr-del" style="width:0"></div></div>
      </div>
      <div class="card" style="margin-bottom:0;margin-top:10px">
        <div class="ctitle">📉 Тренд за выбранный период</div>
        <div style="height:115px"><canvas id="miniC"></canvas></div>
      </div>
    </div>
  </div>
  <div class="card">
    <div class="ctitle">🔔 На что обратить внимание</div>
    <div id="insBox" style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px"></div>
  </div>
</div>

<!-- ══ DYNAMICS ══ -->
<div class="panel" id="p-dynamics">
  <div class="prow" style="flex-wrap:wrap;gap:10px;margin-bottom:8px">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <select id="dynRestSel" onchange="setDynRest(this.value)"
        style="background:var(--card);border:1px solid var(--border2);color:var(--text);padding:6px 10px;border-radius:8px;font-family:Inter,sans-serif;font-size:12px;cursor:pointer;outline:none;max-width:220px">
      </select>
    </div>
    <div class="pgroup">
      <button class="pbtn active" onclick="setDynQ(7,this)">7д</button>
      <button class="pbtn" onclick="setDynQ(14,this)">14д</button>
      <button class="pbtn" onclick="setDynQ(30,this)">Мес</button>
      <button class="pbtn" onclick="setDynQ(90,this)">Квар</button>
      <button class="pbtn" onclick="setDynQ(365,this)">Год</button>
    </div>
  </div>

  <div class="card" style="margin-bottom:12px">
    <div class="ctitle">💰 Выручка по дням</div>
    <div class="mrow" id="revMBtns">
      <button class="mtbtn active" onclick="setRevM('revenue',this)">Общая</button>
      <button class="mtbtn" onclick="setRevM('kitchen',this)">Кухня</button>
      <button class="mtbtn" onclick="setRevM('bar',this)">Бар</button>
      <button class="mtbtn" onclick="setRevM('delivery',this)">Доставка</button>
    </div>
    <div style="height:220px"><canvas id="revC"></canvas></div>
  </div>
  <div class="g2">
    <div class="card"><div class="ctitle">🧾 Средний чек (₽)</div><div style="height:150px"><canvas id="chkC"></canvas></div></div>
    <div class="card"><div class="ctitle">🔢 Количество чеков</div><div style="height:150px"><canvas id="cntC"></canvas></div></div>
  </div>
  <div class="g2">
    <div class="card"><div class="ctitle">🥩 Фудкост %</div><div style="height:150px"><canvas id="fcC"></canvas></div></div>
    <div class="card"><div class="ctitle">🏷️ Скидки %</div><div style="height:150px"><canvas id="discC"></canvas></div></div>
  </div>

  <!-- DOW Analysis -->
  <div class="card" style="margin-bottom:12px">
    <div class="ctitle" style="margin-bottom:6px">📅 Анализ по дням недели</div>
    <div class="mrow" id="dowMetBtns" style="margin-bottom:12px">
      <button class="mtbtn active" onclick="setDOWMet('revenue',this)">Выручка</button>
      <button class="mtbtn" onclick="setDOWMet('avgCheck',this)">Ср. чек</button>
      <button class="mtbtn" onclick="setDOWMet('checks',this)">Чеки</button>
      <button class="mtbtn" onclick="setDOWMet('foodcost',this)">Фудкост</button>
      <button class="mtbtn" onclick="setDOWMet('discount',this)">Скидки</button>
    </div>
    <div id="dowCards" class="dow-grid"></div>
    <div style="height:170px"><canvas id="dowC"></canvas></div>
  </div>

  <!-- Day comparison -->
  <div class="card" style="margin-bottom:12px">
    <div class="ctitle" style="margin-bottom:6px">🔄 Сравнение конкретных дней</div>
    <div class="prow" style="margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-size:11px;color:var(--text2)">Показать:</span>
        <div class="pgroup" id="dowFilterBtns" style="flex-wrap:wrap">
          <button class="pbtn active" onclick="setDowFilter('all',this)">Все дни</button>
          <button class="pbtn" onclick="setDowFilter('weekday',this)">Будни</button>
          <button class="pbtn" onclick="setDowFilter('weekend',this)">Выходные</button>
          <button class="pbtn" onclick="setDowFilter('mon',this)">Пн</button>
          <button class="pbtn" onclick="setDowFilter('tue',this)">Вт</button>
          <button class="pbtn" onclick="setDowFilter('wed',this)">Ср</button>
          <button class="pbtn" onclick="setDowFilter('thu',this)">Чт</button>
          <button class="pbtn" onclick="setDowFilter('fri',this)">Пт</button>
          <button class="pbtn" onclick="setDowFilter('sat',this)">Сб</button>
          <button class="pbtn" onclick="setDowFilter('sun',this)">Вс</button>
        </div>
      </div>
    </div>
    <div style="height:180px"><canvas id="dowFilterC"></canvas></div>
    <div id="dowStats" style="margin-top:10px;font-size:11px;color:var(--text2)"></div>
  </div>

  <div class="card">
    <div class="ctitle">📋 Статистика периода</div>
    <div style="overflow-x:auto"><table class="ctbl"><thead><tr><th>Метрика</th><th>Мин</th><th>Макс</th><th>Среднее</th><th>Последний</th><th>Тренд</th></tr></thead><tbody id="dynStatB"></tbody></table></div>
  </div>
</div>

<!-- ══ COMPARE ══ -->
<div class="panel" id="p-compare">
  <div class="period-panel" style="gap:8px;margin-bottom:12px">
    <span class="plbl">KPI за</span>
    <div class="pbtns2" id="periodBtns">
      <button class="pbtn2" onclick="setPeriod('day',this)">День</button>
      <button class="pbtn2 active" onclick="setPeriod('week',this)">7 дней</button>
      <button class="pbtn2" onclick="setPeriod('month',this)">30 дней</button>
    </div>
    <div class="psep"></div>
    <span class="plbl">vs</span>
    <div class="pbtns2" id="compareBtns">
      <button class="pbtn2 active" onclick="setCompareTo('prev',this)">Пред.</button>
      <button class="pbtn2" onclick="setCompareTo('network',this)">Сеть</button>
      <button class="pbtn2" onclick="setCompareTo('top10',this)">ТОП-10</button>
    </div>
    <span class="pdesc" id="periodDesc">Среднее за 7 дней / пред. 7 дней</span>
  </div>
  <div class="prow">
    <div style="font-size:13px;font-weight:600">Сравнение точек <span style="background:rgba(212,168,75,.15);color:var(--gold);font-size:10px;padding:2px 8px;border-radius:12px;margin-left:6px">до 5 точек</span></div>
    <div style="display:flex;align-items:center;gap:8px"></div>
  </div>

  <div class="comp-area" id="compSlots"></div>

  <div class="card" style="margin-bottom:12px">
    <div class="ctitle">📊 Сравнение метрик</div>
    <div class="mrow" id="compMBtns">
      <button class="mtbtn active" onclick="setCmpM('revenue',this)">Выручка</button>
      <button class="mtbtn" onclick="setCmpM('avgCheck',this)">Ср. чек</button>
      <button class="mtbtn" onclick="setCmpM('checks',this)">Чеки</button>
      <button class="mtbtn" onclick="setCmpM('foodcost',this)">Фудкост</button>
      <button class="mtbtn" onclick="setCmpM('discount',this)">Скидки</button>
      <button class="mtbtn" onclick="setCmpM('delivPct',this)">Доставка%</button>
    </div>
    <div style="height:200px"><canvas id="cmpBarC"></canvas></div>
  </div>
  <div class="card" style="margin-bottom:12px">
    <div class="ctitle">📈 Тренд выручки</div>
    <div style="height:200px"><canvas id="cmpTrC"></canvas></div>
  </div>
  <div class="card" style="margin-bottom:12px">
    <div class="ctitle">🗂️ Детальная таблица</div>
    <div style="overflow-x:auto"><table class="ctbl"><thead id="cmpTH"></thead><tbody id="cmpTB"></tbody></table></div>
  </div>
  <div class="card">
    <div class="ctitle">🌐 Все точки vs Сеть vs ТОП-10</div>
    <div style="overflow-x:auto"><table class="ctbl"><thead><tr><th>Метрика</th><th style="color:var(--gold)" id="netTH_own"></th><th>Сеть (ср.)</th><th style="color:var(--gold2)">ТОП-10</th><th>vs Сеть</th><th>vs ТОП-10</th></tr></thead><tbody id="netTB"></tbody></table></div>
  </div>
</div>

<!-- ══ ANALYSIS ══ -->
<div class="panel" id="p-analysis">
  <!-- Weekday vs Weekend -->
  <div class="card" style="margin-bottom:12px">
    <div class="ctitle">📅 Будни vs Выходные — ключевые различия</div>
    <div class="wdb-grid" id="wdbGrid"></div>
    <div style="height:170px;margin-bottom:10px"><canvas id="wdC"></canvas></div>
    <div id="wdbInsights" style="display:grid;grid-template-columns:1fr 1fr;gap:8px"></div>
  </div>

  <!-- P&L Calculator -->
  <div class="card" style="margin-bottom:12px">
    <div class="ctitle">🧮 P&L Калькулятор «Что если»</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:20px">
      <!-- Sliders -->
      <div>
        <div style="font-size:10px;color:var(--text2);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;font-weight:600">Параметры</div>
        <div class="sl-row">
          <div class="sl-hdr"><span class="sl-name">Средний чек (₽)</span><span class="sl-val" id="sl-chk-v">—</span></div>
          <input type="range" id="sl-chk" min="300" max="3500" step="10" oninput="calcPL()">
          <div style="display:flex;justify-content:space-between;font-size:9px;color:var(--text3);margin-top:2px"><span>300₽</span><span>3500₽</span></div>
        </div>
        <div class="sl-row">
          <div class="sl-hdr"><span class="sl-name">Чеков в день</span><span class="sl-val" id="sl-cnt-v">—</span></div>
          <input type="range" id="sl-cnt" min="5" max="400" step="1" oninput="calcPL()">
        </div>
        <div class="sl-row">
          <div class="sl-hdr"><span class="sl-name">Фудкост (%)</span><span><span class="sl-val" id="sl-fc-v">—</span><span class="sl-unit">%</span></span></div>
          <input type="range" id="sl-fc" min="12" max="40" step="0.1" oninput="calcPL()">
        </div>
        <div class="sl-row">
          <div class="sl-hdr"><span class="sl-name">Скидки (%)</span><span><span class="sl-val" id="sl-disc-v">—</span><span class="sl-unit">%</span></span></div>
          <input type="range" id="sl-disc" min="0" max="25" step="0.1" oninput="calcPL()">
        </div>
        <div style="display:flex;gap:6px;margin-top:4px">
          <button onclick="resetPL()" style="padding:5px 12px;background:rgba(212,168,75,.12);border:1px solid rgba(212,168,75,.25);border-radius:6px;color:var(--gold);font-size:10px;cursor:pointer;font-family:Inter,sans-serif">↺ Факт</button>
          <button onclick="setWDayPL()" style="padding:5px 12px;background:rgba(74,158,245,.12);border:1px solid rgba(74,158,245,.25);border-radius:6px;color:var(--blue);font-size:10px;cursor:pointer;font-family:Inter,sans-serif">📅 Будни</button>
          <button onclick="setWEndPL()" style="padding:5px 12px;background:rgba(212,168,75,.12);border:1px solid rgba(212,168,75,.25);border-radius:6px;color:var(--gold);font-size:10px;cursor:pointer;font-family:Inter,sans-serif">🎉 Выходные</button>
        </div>
      </div>
      <!-- Current P&L -->
      <div>
        <div style="font-size:10px;color:var(--blue);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;font-weight:600">Текущий факт</div>
        <div id="plCurrent"></div>
      </div>
      <!-- Adjusted P&L -->
      <div>
        <div style="font-size:10px;color:var(--gold);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;font-weight:600">Ваш сценарий</div>
        <div id="plAdjusted"></div>
      </div>
    </div>
  </div>

  <!-- Forecast -->
  <div class="card" style="margin-bottom:12px">
    <div class="ctitle">📈 Прогноз на 30 дней</div>
    <div class="fc-compare" id="fcBoxes"></div>
    <div style="height:180px"><canvas id="fcC30"></canvas></div>
    <div id="fcDelta" style="margin-top:10px;display:grid;grid-template-columns:repeat(4,1fr);gap:8px"></div>
  </div>

  <!-- Breakeven & Scenarios -->
  <div class="g2">
    <div class="card">
      <div class="ctitle">⚖️ Точка безубыточности</div>
      <div id="breakevenBox"></div>
    </div>
    <div class="card">
      <div class="ctitle">🎯 Сценарии улучшений</div>
      <div id="scenBox"></div>
    </div>
  </div>

  <div class="card">
    <div class="ctitle">📊 Структура нетто-выручки</div>
    <div style="height:185px"><canvas id="plBarC"></canvas></div>
  </div>
</div>

<!-- ══ В РАЗРАБОТКЕ ══ -->
<div class="panel" id="p-dev">
  <div style="text-align:center;padding:8px 0 20px">
    <div style="font-family:'Cormorant Garamond',serif;font-size:30px;color:var(--gold);margin-bottom:6px">🛠️ Продукт в активной разработке</div>
    <div style="color:var(--text2);font-size:12px">Ниже — функции в пайплайне, дорожная карта и кейсы использования</div>
  </div>

  <div class="g2">
    <!-- Roadmap -->
    <div class="card">
      <div class="ctitle">🗺️ Дорожная карта</div>
      <div class="rm-q">
        <div class="rm-q-hdr"><span class="rm-q-lbl done">✅ Апрель 2026 — готово</span></div>
        <div class="rm-items">
          <div class="rm-item done"><span class="rm-ico">✅</span>Мультиресторанный дашборд</div>
          <div class="rm-item done"><span class="rm-ico">✅</span>KPI-карточки с трендами</div>
          <div class="rm-item done"><span class="rm-ico">✅</span>Сравнение до 5 точек</div>
          <div class="rm-item done"><span class="rm-ico">✅</span>P&L калькулятор с прогнозом</div>
          <div class="rm-item done"><span class="rm-ico">✅</span>Анализ будни/выходные</div>
          <div class="rm-item done"><span class="rm-ico">✅</span>Анализ по дням недели (DOW)</div>
        </div>
      </div>
      <div class="rm-q">
        <div class="rm-q-hdr"><span class="rm-q-lbl current">🔧 Q2 2026 — в работе</span></div>
        <div class="rm-items">
          <div class="rm-item"><span class="rm-ico">🔧</span>Интеграция iiko — склад и смены</div>
          <div class="rm-item"><span class="rm-ico">🔧</span>Мониторинг 2ГИС / Яндекс рейтинги</div>
          <div class="rm-item"><span class="rm-ico">🔧</span>Корреляция погода × выручка</div>
          <div class="rm-item"><span class="rm-ico">🔧</span>Мобильное приложение (iOS/Android)</div>
        </div>
      </div>
      <div class="rm-q">
        <div class="rm-q-hdr"><span class="rm-q-lbl next">🎯 Q3 2026 — планируется</span></div>
        <div class="rm-items">
          <div class="rm-item"><span class="rm-ico">📋</span>Управление складом с автозаказом</div>
          <div class="rm-item"><span class="rm-ico">📋</span>QR-метрики и онлайн-меню</div>
          <div class="rm-item"><span class="rm-ico">📋</span>Контроль ФОТ и эффективности смен</div>
          <div class="rm-item"><span class="rm-ico">📋</span>Push-уведомления по алертам</div>
        </div>
      </div>
      <div class="rm-q" style="margin-bottom:0">
        <div class="rm-q-hdr"><span class="rm-q-lbl future">🔮 Q4 2026 — будущее</span></div>
        <div class="rm-items">
          <div class="rm-item"><span class="rm-ico">🤖</span>ML-прогнозы выручки на 30 дней</div>
          <div class="rm-item"><span class="rm-ico">🤖</span>AI-ассистент в чате</div>
          <div class="rm-item"><span class="rm-ico">🔮</span>Тепловые карты посещаемости</div>
          <div class="rm-item"><span class="rm-ico">🔮</span>Управление меню и ценами</div>
        </div>
      </div>
    </div>

    <!-- Upcoming features -->
    <div style="display:flex;flex-direction:column;gap:12px">
      <div class="card lock-card" style="flex:1">
        <div class="lock-prev">
          <div class="ctitle">⭐ Рейтинги и отзывы</div>
          <div style="display:flex;gap:16px;margin-bottom:10px">
            <div style="text-align:center"><div style="font-family:'Cormorant Garamond',serif;font-size:24px;color:var(--gold)">4.7</div><div style="font-size:9px;color:var(--text2)">2ГИС</div></div>
            <div style="text-align:center"><div style="font-family:'Cormorant Garamond',serif;font-size:24px;color:var(--gold)">4.5</div><div style="font-size:9px;color:var(--text2)">Яндекс</div></div>
            <div style="text-align:center"><div style="font-family:'Cormorant Garamond',serif;font-size:24px;color:var(--green)">72</div><div style="font-size:9px;color:var(--text2)">NPS</div></div>
          </div>
          <div style="height:60px;background:var(--border);border-radius:8px"></div>
        </div>
        <div class="lock-over"><div class="lock-ico">⭐</div><div class="lock-t">Рейтинги и отзывы</div><div class="lock-d">Мониторинг 2ГИС, Яндекс, Google. NPS-трекер. Алерты на негатив.</div><div class="lock-chip">Q2 2026</div></div>
      </div>
      <div class="card lock-card" style="flex:1">
        <div class="lock-prev">
          <div class="ctitle">👨‍🍳 Эффективность персонала</div>
          <div style="display:flex;flex-direction:column;gap:4px">
            <div style="display:flex;justify-content:space-between;font-size:10px;padding:5px 0;border-bottom:1px solid var(--border)"><span style="color:var(--text2)">Алексей К.</span><span style="color:var(--gold)">38 чеков · 1820₽</span></div>
            <div style="display:flex;justify-content:space-between;font-size:10px;padding:5px 0"><span style="color:var(--text2)">Мария В.</span><span style="color:var(--gold)">31 чек · 1650₽</span></div>
          </div>
        </div>
        <div class="lock-over"><div class="lock-ico">👨‍🍳</div><div class="lock-t">Персонал и смены</div><div class="lock-d">ТОП официантов, KPI смен, выработка. Интеграция iiko.</div><div class="lock-chip">Q2 2026</div></div>
      </div>
      <div class="card lock-card" style="flex:1">
        <div class="lock-prev">
          <div class="ctitle">📦 Склад и оборачиваемость</div>
          <div style="display:flex;flex-direction:column;gap:6px">
            <div style="display:flex;align-items:center;gap:8px"><div style="width:7px;height:7px;border-radius:50%;background:var(--red)"></div><span style="font-size:10px;color:var(--text2)">Куриное филе — заканчивается!</span></div>
            <div style="display:flex;align-items:center;gap:8px"><div style="width:7px;height:7px;border-radius:50%;background:var(--amber)"></div><span style="font-size:10px;color:var(--text2)">Сыр чеддер — 2 дня запаса</span></div>
          </div>
        </div>
        <div class="lock-over"><div class="lock-ico">📦</div><div class="lock-t">Склад и автозаказ</div><div class="lock-d">Остатки, алерты на минимум, автозаявки поставщикам.</div><div class="lock-chip">Q3 2026</div></div>
      </div>
    </div>
  </div>

  <!-- Use Cases -->
  <div style="margin-top:4px">
    <div style="font-family:'Cormorant Garamond',serif;font-size:22px;margin:16px 0 12px;color:var(--text)">💼 Кейсы — как аналитика меняет бизнес</div>
    <div class="case-card">
      <div class="case-header"><div class="case-num">01</div><div><div class="case-title">Снижение фудкоста с 28% до 21% за 8 недель</div><div class="case-sub">Ресторан в Воронеже · Q1 2026</div></div></div>
      <div class="case-body">Франчайзи заметил через дашборд, что фудкост в понедельник стабильно выше на 4–5% относительно пятницы. Анализ показал: в начале недели повара готовили по «воскресным нормам» без коррекции на меньший трафик. Введён еженедельный план-факт по закупкам на основе DOW-прогноза. За 8 недель фудкост снизился с 28% до 21%.</div>
      <div class="case-results">
        <div class="case-kpi"><div class="case-kpi-v">−7%</div><div class="case-kpi-l">фудкост</div></div>
        <div class="case-kpi"><div class="case-kpi-v">+182К₽</div><div class="case-kpi-l">прибыль/мес</div></div>
        <div class="case-kpi"><div class="case-kpi-v">8 нед</div><div class="case-kpi-l">до результата</div></div>
      </div>
    </div>
    <div class="case-card">
      <div class="case-header"><div class="case-num">02</div><div><div class="case-title">Рост среднего чека на 18% через умные допродажи</div><div class="case-sub">Ресторан в Москве (Серпуховская) · Q4 2025</div></div></div>
      <div class="case-body">Дашборд показал: средний чек в будни на 35% ниже, чем в выходные. Оказалось, в будни персонал не предлагал допродажи из-за высокой загруженности. После внедрения чеклиста по допродажам для будних смен и скрипта для официантов средний чек в будни вырос с 1240₽ до 1466₽ за 6 недель.</div>
      <div class="case-results">
        <div class="case-kpi"><div class="case-kpi-v">+18%</div><div class="case-kpi-l">средний чек</div></div>
        <div class="case-kpi"><div class="case-kpi-v">+94К₽</div><div class="case-kpi-l">выручка/мес</div></div>
        <div class="case-kpi"><div class="case-kpi-v">6 нед</div><div class="case-kpi-l">до результата</div></div>
      </div>
    </div>
    <div class="case-card">
      <div class="case-header"><div class="case-num">03</div><div><div class="case-title">Доставка: рост с 8% до 24% доли выручки</div><div class="case-sub">Ресторан в Калининграде · 2025–2026</div></div></div>
      <div class="case-body">Сравнение с сетью показало: у точки доля доставки 8% при среднем 16% по сети. После регистрации на Яндекс Еде и оптимизации меню для доставки (убрали позиции с плохой упаковкой) доля выросла до 24% за 3 месяца. Общая выручка выросла на 22% без увеличения зала.</div>
      <div class="case-results">
        <div class="case-kpi"><div class="case-kpi-v">+16%</div><div class="case-kpi-l">доля доставки</div></div>
        <div class="case-kpi"><div class="case-kpi-v">+22%</div><div class="case-kpi-l">выручка</div></div>
        <div class="case-kpi"><div class="case-kpi-v">3 мес</div><div class="case-kpi-l">до результата</div></div>
      </div>
    </div>
    <div class="case-card">
      <div class="case-header"><div class="case-num">04</div><div><div class="case-title">Оптимизация скидок: с 14% до 6% без потери трафика</div><div class="case-sub">Сеть из 3 точек в Новосибирске · Q1 2026</div></div></div>
      <div class="case-body">AI-инсайты дашборда показали: скидки 14% — вдвое выше нормы сети. Но анализ по дням недели выявил: скидки давались одинаково в будни и выходные, хотя в выходные трафик и без того высокий. После перехода на скидки только в будни и замены части скидок на систему накопительных баллов средний % скидок упал до 6%, а количество чеков выросло.</div>
      <div class="case-results">
        <div class="case-kpi"><div class="case-kpi-v">−8%</div><div class="case-kpi-l">скидки</div></div>
        <div class="case-kpi"><div class="case-kpi-v">+11%</div><div class="case-kpi-l">чеков/день</div></div>
        <div class="case-kpi"><div class="case-kpi-v">+267К₽</div><div class="case-kpi-l">прибыль/мес</div></div>
      </div>
    </div>
  </div>
</div>

</div><!-- /main -->

<script>
// ═══ API CONFIG v5.0 (JWT via /api/query) ═══
const API_BASE = location.origin;
const JWT_KEY = 'chicko_jwt';

function getJWT() { return localStorage.getItem(JWT_KEY); }
function setJWT(t) { localStorage.setItem(JWT_KEY, t); }
function clearJWT() { localStorage.removeItem(JWT_KEY); }

function showLogin() {
  const scr = document.getElementById('login-screen');
  if (scr) scr.classList.remove('hidden');
}
function hideLogin() {
  const scr = document.getElementById('login-screen');
  if (scr) scr.classList.add('hidden');
}

async function fetchCK(sql) {
  const jwt = getJWT();
  if (!jwt) { showLogin(); throw new Error('Not authenticated'); }
  const r = await fetch(API_BASE + '/api/query', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + jwt
    },
    body: JSON.stringify({ query: sql })
  });
  if (r.status === 401) {
    clearJWT();
    showLogin();
    throw new Error('Session expired');
  }
  const j = await r.json();
  if (j.error) throw new Error(j.message || j.error);
  return j.data || [];
}

// ═══ Login form handler ═══
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('loginForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim().toLowerCase();
    const btn = document.getElementById('loginBtn');
    const msg = document.getElementById('loginMsg');
    if (!email || !email.includes('@')) {
      msg.textContent = 'Введите корректный email';
      msg.className = 'login-msg error';
      return;
    }
    btn.disabled = true;
    btn.textContent = 'Отправляем...';
    msg.textContent = '';
    try {
      const r = await fetch(API_BASE + '/api/auth/request-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      if (r.status === 429) {
        msg.textContent = 'Слишком часто. Попробуйте через минуту.';
        msg.className = 'login-msg error';
      } else {
        msg.textContent = 'Если email зарегистрирован — ссылка отправлена. Проверьте почту.';
        msg.className = 'login-msg success';
      }
    } catch (err) {
      msg.textContent = 'Ошибка: ' + err.message;
      msg.className = 'login-msg error';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Получить ссылку';
    }
  });
});

// ═══ Auth flow on page load ═══
(async function bootAuth() {
  const url = new URL(location.href);
  const loginToken = url.searchParams.get('login_token');
  if (loginToken) {
    try {
      const r = await fetch(API_BASE + '/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: loginToken })
      });
      const j = await r.json();
      if (j.success && j.token) {
        setJWT(j.token);
        url.searchParams.delete('login_token');
        history.replaceState({}, '', url.pathname + url.search + url.hash);
      } else {
        showLogin();
        return;
      }
    } catch (e) {
      showLogin();
      return;
    }
  }
  if (!getJWT()) {
    showLogin();
  } else {
    hideLogin();
  }
})();

let RESTS = [];
// NET и TOP10 — значения по сети. Заполняются динамически через loadNetworkBenchmarks()
// за тот же период что выбран пользователем (см. решение паспорта 5.25).
// Начальные дефолты — только на случай если запрос не вернёт данных.
let NET   = { revenue: 0, avgCheck: 0, checks: 0, foodcost: 0, discount: 0, deliveryPct: 0, restCount: 0 };
let TOP10 = { revenue: 0, avgCheck: 0, foodcost: 0, discount: 0, deliveryPct: 0 };

// DOW-профили: like-for-like сравнения. Загружаются один раз при старте
// и при смене выбранного ресторана. Окно — 90 дней.
// NET_DOW[1..7] — профиль сети по дням недели (1=Пн..7=Вс, ISO).
// MY_DOW[1..7]  — профиль текущего ресторана по дням недели.
// В каждом элементе: {rev_p50, rev_p75, chk_p50, chk_p75, cnt_p50, fc_p50, fc_p25, disc_p50, disc_p25, del_p50, del_p75, n}
// n — число точек данных (дней) в расчёте, для fallback'а.
let NET_DOW = {};
let MY_DOW  = {};
let MY_DOW_DAYS = 0; // всего дней истории у текущего ресторана (для фоллбэка <14 → скрываем "вашу норму")
let ALL_DATES = [];
let MIN_DATE = '';
let MAX_DATE = '';
let RESTAURANT_SCORE = null;
let RESTAURANT_RECS  = [];

// ═══ STATE ═══
const S = {
  restIdx: 0,
  globalStart: '', globalEnd: '',
  dynStart: '',    dynEnd: '', dynRestIdx: -1,
  cmpStart: '',    cmpEnd: '',
  dynPeriod: 7,
  revMetric: 'revenue', dowMetric: 'revenue', dowFilter: 'all', compMetric: 'revenue',
  plChk: 0, plCnt: 0, plFc: 0, plDisc: 0,
};
let R = null;
const CHS = {};
const COMP_COLORS=['#D4A84B','#1ABC9C','#9B59B6','#F39C12','#E74C3C'];
const N_COMP=5;
const DOW_NAMES=['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
const DOW_EN=['sun','mon','tue','wed','thu','fri','sat'];
const CHART_OPTS={responsive:true,maintainAspectRatio:false,
  plugins:{legend:{labels:{color:'#8AAACE',font:{size:9},boxWidth:10}}},
  scales:{
    x:{grid:{color:'rgba(46,64,104,.4)'},ticks:{color:'#4E6A90',font:{size:9}}},
    y:{grid:{color:'rgba(46,64,104,.4)'},ticks:{color:'#4E6A90',font:{size:9}}}
  }
};
const CAL_STATE = {};


// ═══ SEARCHABLE SELECTOR ═══
let _selOpen = false;
function buildSelList(list, query='') {
  const ul = document.getElementById('selList');
  const cnt = document.getElementById('selCount');
  if (!ul) return;
  const q = query.toLowerCase();
  const filtered = q ? list.filter(r => (r.name+r.city).toLowerCase().includes(q)) : list;
  ul.innerHTML = filtered.map((r,i) => {
    const idx = RESTS.indexOf(r);
    const isActive = R && r.name === R.name;
    return \`<div class="sel-item\${isActive?' active':''}" onclick="pickRest(\${idx})">
      <span style="font-weight:500;color:var(--text)">\${r.city}</span>
      <span class="sel-city" style="flex:1;text-align:right">\${r.name.replace('Чико (','').replace(')','').replace('Чико Рико ','Рико ').slice(0,24)}</span>
    </div>\`;
  }).join('');
  if (cnt) cnt.textContent = filtered.length + ' из ' + RESTS.length + ' ресторанов';
}
function toggleSelDropdown() {
  const dd = document.getElementById('selDropdown');
  _selOpen = !_selOpen;
  dd.classList.toggle('open', _selOpen);
  if (_selOpen) {
    setTimeout(()=>document.getElementById('selFilter')?.focus(), 50);
  }
}
function filterSel(q) {
  buildSelList(RESTS, q);
}
function pickRest(idx) {
  const dd = document.getElementById('selDropdown');
  _selOpen = false;
  dd.classList.remove('open');
  const inp = document.getElementById('selSearch');
  if (inp) {
    const r = RESTS[idx];
    inp.value = r.city;
  }
  document.getElementById('selFilter').value = '';
  buildSelList(RESTS);
  selectRest(idx);
}
document.addEventListener('click', e => {
  if (!e.target.closest('#selWrap')) {
    const dd = document.getElementById('selDropdown');
    if (dd) { dd.classList.remove('open'); _selOpen = false; }
  }
});


// ═══ INIT (async) ═══
function showLoader(msg) {
  let el = document.getElementById('ck-loader');
  if (!el) {
    el = document.createElement('div');
    el.id = 'ck-loader';
    el.style.cssText = 'position:fixed;inset:0;background:rgba(7,9,14,.9);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:9999;gap:14px;font-family:Inter,sans-serif';
    el.innerHTML = '<div style="width:40px;height:40px;border:3px solid #2E4068;border-top-color:#D4A84B;border-radius:50%;animation:spin .8s linear infinite"></div><div id="ck-msg" style="color:#8AAACE;font-size:13px"></div><style>@keyframes spin{to{transform:rotate(360deg)}}</style>';
    document.body.appendChild(el);
  }
  document.getElementById('ck-msg').textContent = msg || '';
}
function hideLoader() { const el=document.getElementById('ck-loader'); if(el) el.remove(); }

async function init() {
  if (!getJWT()) { showLogin(); return; }
  showLoader('Подключение к данным...');
  try {
    showLoader('Загрузка истории с 2024 года...');
    const rows = await fetchCK(\`SELECT dept_id, restaurant_name, city, toString(report_date) AS report_date_str, revenue_total_rub, revenue_bar_rub, revenue_kitchen_rub, revenue_delivery_rub, avg_check_total_rub, checks_total, foodcost_total_pct, discount_total_pct, delivery_share_pct, is_anomaly_day FROM chicko.mart_restaurant_daily_base WHERE report_date >= today() - 90 AND revenue_total_rub > 0 ORDER BY restaurant_name, report_date\`);
    const restMap = {};
    for (const row of rows) {
      const id = row.dept_id;
      if (!restMap[id]) restMap[id] = { id:+id, name:row.restaurant_name, city:row.city, ts:[] };
      if(+row.is_anomaly_day!==1) restMap[id].ts.push({ date:row.report_date_str, revenue:+row.revenue_total_rub||0, bar:+row.revenue_bar_rub||0, kitchen:+row.revenue_kitchen_rub||0, delivery:+row.revenue_delivery_rub||0, avgCheck:+row.avg_check_total_rub||0, checks:+row.checks_total||0, itemsPerCheck:0, foodcost:+row.foodcost_total_pct||0, discount:+row.discount_total_pct||0, deliveryPct:+row.delivery_share_pct||0 });
    }
    RESTS = Object.values(restMap).filter(r=>r.ts.length>0).sort((a,b)=>a.city.localeCompare(b.city,'ru')||a.name.localeCompare(b.name,'ru'));
    for (const r of RESTS) {
      const last=r.ts[r.ts.length-1];
      r.revenue=last.revenue; r.bar=last.bar; r.kitchen=last.kitchen; r.delivery=last.delivery;
      r.avgCheck=last.avgCheck; r.checks=last.checks; r.itemsPerCheck=0;
      r.foodcost=last.foodcost; r.discount=last.discount;
      const revs=r.ts.map(t=>t.revenue).filter(v=>v>0);
      r.avgRevenue=revs.length?revs.reduce((a,b)=>a+b,0)/revs.length:0;
      r.avgRevenue7=revs.slice(-7).length?revs.slice(-7).reduce((a,b)=>a+b,0)/revs.slice(-7).length:0;
    }
    // Сетевые бенчмарки грузятся отдельной функцией чуть ниже, после установки
    // глобального периода из ALL_DATES. Оставляем NET/TOP10 нулевыми до того момента.
    ALL_DATES=[...new Set(RESTS.flatMap(r=>r.ts.map(t=>t.date)))].sort();
    MIN_DATE=ALL_DATES[0]||''; MAX_DATE=ALL_DATES[ALL_DATES.length-1]||'';
    S.globalStart=S.dynStart=S.cmpStart=MIN_DATE;
    S.globalEnd=S.dynEnd=S.cmpEnd=MAX_DATE;
    // Загружаем бенчмарки сети за тот же период что у точки (решение паспорта 5.25)
    showLoader('Расчёт показателей по сети...');
    await loadNetworkBenchmarks(S.globalStart, S.globalEnd);
    // Populate hidden select for compat
    const sel=document.getElementById('mainSel');
    sel.innerHTML='';
    RESTS.forEach((r,i)=>sel.add(new Option(r.name+' ('+r.city+')',i)));
    // Build searchable list
    buildSelList(RESTS);
    buildCompSlots(); buildCalendars();
    hideLoader();
    selectRest(0);
    buildDynRestSel();
    // Тихая фоновая загрузка истории с 2024 через 2 сек после старта
    setTimeout(()=>loadFullHistory(true), 2000);
  } catch(e) {
    hideLoader();
    document.body.innerHTML+='<div style="position:fixed;inset:0;background:#0D1420;display:flex;align-items:center;justify-content:center;color:#E74C3C;font-size:14px;font-family:Inter,sans-serif;z-index:9999">Ошибка: '+e.message+'</div>';
    console.error(e);
  }
}


async function loadFullHistory(silent=false) {
  const btn = document.getElementById('loadHistBtn');
  if (btn) { btn.textContent = '⏳ Загрузка...'; btn.disabled = true; }
  try {
    if(!silent) showLoader('Загрузка истории с 2024 года...');
    const rows = await fetchCK(\`SELECT dept_id, restaurant_name, city, toString(report_date) AS report_date_str, revenue_total_rub, revenue_bar_rub, revenue_kitchen_rub, revenue_delivery_rub, avg_check_total_rub, checks_total, foodcost_total_pct, discount_total_pct, delivery_share_pct, is_anomaly_day FROM chicko.mart_restaurant_daily_base WHERE report_date >= '2024-01-01' AND revenue_total_rub > 0 ORDER BY restaurant_name, report_date\`);
    const restMap = {};
    for (const row of rows) {
      const id = row.dept_id;
      if (!restMap[id]) restMap[id] = { id:+id, name:row.restaurant_name, city:row.city, ts:[] };
      if(+row.is_anomaly_day!==1) restMap[id].ts.push({ date:row.report_date_str, revenue:+row.revenue_total_rub||0, bar:+row.revenue_bar_rub||0, kitchen:+row.revenue_kitchen_rub||0, delivery:+row.revenue_delivery_rub||0, avgCheck:+row.avg_check_total_rub||0, checks:+row.checks_total||0, itemsPerCheck:0, foodcost:+row.foodcost_total_pct||0, discount:+row.discount_total_pct||0, deliveryPct:+row.delivery_share_pct||0 });
    }
    // Merge into existing RESTS (update ts for each)
    for (const id in restMap) {
      const existing = RESTS.find(r => r.id === +id);
      if (existing) existing.ts = restMap[id].ts;
    }
    ALL_DATES = [...new Set(RESTS.flatMap(r => r.ts.map(t => t.date)))].sort();
    MIN_DATE = ALL_DATES[0] || '';
    buildCalendars();
    if(!silent) hideLoader();
    if (btn) { btn.textContent = '✅ История загружена (2024–)'; btn.disabled = true; btn.style.color='var(--green)'; }
    const tsEl=document.getElementById('dataTsVal');
    if(tsEl&&MIN_DATE) {
      const d=new Date(MIN_DATE);
      tsEl.title='Данные с '+d.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric'});
    }
    renderAll();
  } catch(e) {
    if(!silent) hideLoader();
    if (btn) { btn.textContent = '❌ Ошибка загрузки'; btn.disabled = false; }
  }
}

async function selectRest(idx) {
  // Сбрасываем режим «Вся сеть» при выборе ресторана
  if (NETWORK_MODE) {
    NETWORK_MODE = false;
    const cb = document.getElementById('netCb'); if (cb) cb.checked = false;
    const sw = document.getElementById('selWrap'); if (sw) { sw.style.opacity='1'; sw.style.pointerEvents='auto'; }
  }
  R = RESTS[parseInt(idx)];
  document.getElementById('mainSel').value = idx;
  const inp = document.getElementById('selSearch');
  if (inp && R) inp.value = R.city;
  buildSelList(RESTS);
  RESTAURANT_SCORE = null; RESTAURANT_RECS = [];
  renderAll();
  // Загружаем DOW-профили для like-for-like сравнений (сеть + мой ресторан, 90 дней).
  // Делаем это в фоне — первый renderAll уже прошёл с NET/TOP10 из loadNetworkBenchmarks,
  // а после загрузки DOW просто перерисуем заново.
  if (R && R.id) {
    loadDowProfiles(R.id).then(()=>{ try { renderAll(); } catch(e) { console.error('[dow-rerender]', e); }});
  }
  if (R && R.id) {
    try {
      const [scoreData, recsData] = await Promise.all([
        fetchCK(\`SELECT score_total, risk_level, rank_network, restaurants_in_rank, score_revenue, score_traffic, score_avg_check, score_foodcost, score_discount, score_delivery, score_margin FROM chicko.mart_restaurant_scores WHERE restaurant_id=\${R.id} AND score_window='7d' ORDER BY dt DESC LIMIT 1\`),
        fetchCK(\`SELECT recommendation_code, title, description, estimated_effect_rub, confidence, impact_type, category FROM chicko.mart_recommendations WHERE restaurant_id=\${R.id} AND dt=(SELECT max(dt) FROM chicko.mart_recommendations WHERE restaurant_id=\${R.id}) ORDER BY priority_score DESC LIMIT 3\`)
      ]);
      if (scoreData.length) RESTAURANT_SCORE = scoreData[0];
      RESTAURANT_RECS = recsData;
      renderScore(); renderInsights();
    } catch(e) { console.warn('Score/recs:', e.message); }
  }
}

// ═══ NETWORK VIEW (Вся сеть) ═══
let NETWORK_MODE = false;
let SAVED_R = null; // сохраняем выбранный ресторан при переключении

function buildNetworkR() {
  // Агрегируем все рестораны в виртуальный R
  const dateMap = {};
  for (const rest of RESTS) {
    for (const t of rest.ts) {
      if (!dateMap[t.date]) dateMap[t.date] = { date:t.date, revenue:0, bar:0, kitchen:0, delivery:0, checks:0, avgCheck:0, foodcost_w:0, discount_w:0, deliveryPct:0, itemsPerCheck:0 };
      const d = dateMap[t.date];
      d.revenue += t.revenue;
      d.bar += t.bar||0;
      d.kitchen += t.kitchen||0;
      d.delivery += t.delivery||0;
      d.checks += t.checks||0;
      d.foodcost_w += (t.foodcost||0) * t.revenue; // взвешиваем по выручке
      d.discount_w += (t.discount||0) * t.revenue;
    }
  }
  const ts = Object.values(dateMap).map(d => ({
    date: d.date,
    revenue: d.revenue,
    bar: d.bar,
    kitchen: d.kitchen,
    delivery: d.delivery,
    checks: d.checks,
    avgCheck: d.checks > 0 ? d.revenue / d.checks : 0,
    foodcost: d.revenue > 0 ? d.foodcost_w / d.revenue : 0,
    discount: d.revenue > 0 ? d.discount_w / d.revenue : 0,
    deliveryPct: d.revenue > 0 ? d.delivery / d.revenue * 100 : 0,
    itemsPerCheck: 0,
  })).sort((a,b) => a.date.localeCompare(b.date));

  const last = ts[ts.length-1] || {};
  return {
    id: 0,
    name: 'Вся сеть',
    city: RESTS.length + ' ресторанов',
    ts,
    revenue: last.revenue||0,
    bar: last.bar||0,
    kitchen: last.kitchen||0,
    delivery: last.delivery||0,
    avgCheck: last.avgCheck||0,
    checks: last.checks||0,
    foodcost: last.foodcost||0,
    discount: last.discount||0,
    itemsPerCheck: 0,
  };
}

function toggleNetworkView(on) {
  NETWORK_MODE = on;
  const selWrap = document.getElementById('selWrap');
  const inp = document.getElementById('selSearch');

  if (on) {
    SAVED_R = R;
    R = buildNetworkR();
    if (selWrap) selWrap.style.opacity = '0.35';
    if (selWrap) selWrap.style.pointerEvents = 'none';
    if (inp) inp.value = 'Вся сеть';
    // Для сети используем NET_DOW, MY_DOW обнуляем
    MY_DOW = {}; MY_DOW_DAYS = 0;
    RESTAURANT_SCORE = null; RESTAURANT_RECS = [];
  } else {
    if (SAVED_R) R = SAVED_R;
    SAVED_R = null;
    if (selWrap) selWrap.style.opacity = '1';
    if (selWrap) selWrap.style.pointerEvents = 'auto';
    if (inp && R) inp.value = R.city;
    // Перезагружаем DOW-профили для ресторана
    if (R && R.id) {
      loadDowProfiles(R.id).then(()=>{ try { renderAll(); } catch(e) { console.error(e); }});
    }
  }
  renderAll();
}


// ═══ Сетевые бенчмарки (динамические перцентили за текущий период) ═══
//
// Заменяет старый запрос к mart_benchmarks_daily (который давал снимок за
// последние 30 дней перед вчера) на расчёт медианы/перцентилей по
// mart_restaurant_daily_base за тот же период что выбрал пользователь.
//
// Результат кладётся в глобальные NET и TOP10 — остальной код работает без правок.
//
// В TOP10 раньше лежал p90 (выручка, avgCheck) и p25 (foodcost, discount —
// там "меньше = лучше"). Сохраняем ту же семантику, чтобы сравнения
// "лидеры" и "среднее" продолжали работать.
async function loadNetworkBenchmarks(startDate, endDate) {
  const sql = \`
    SELECT
      quantile(0.50)(revenue_total_rub)      AS rev_median,
      quantile(0.90)(revenue_total_rub)      AS rev_p90,
      quantile(0.50)(avg_check_total_rub)    AS chk_median,
      quantile(0.90)(avg_check_total_rub)    AS chk_p90,
      quantile(0.50)(checks_total)           AS cnt_median,
      quantile(0.50)(foodcost_total_pct)     AS fc_median,
      quantile(0.25)(foodcost_total_pct)     AS fc_p25,
      quantile(0.50)(discount_total_pct)     AS disc_median,
      quantile(0.25)(discount_total_pct)     AS disc_p25,
      quantile(0.50)(delivery_share_pct)     AS del_median,
      quantile(0.90)(delivery_share_pct)     AS del_p90,
      count(DISTINCT dept_uuid)              AS rest_count
    FROM chicko.mart_restaurant_daily_base
    WHERE report_date BETWEEN '\${startDate}' AND '\${endDate}'
      AND is_anomaly_day = 0
      AND revenue_total_rub > 0
  \`;
  try {
    const rows = await fetchCK(sql);
    if (!rows.length) {
      console.warn('[benchmarks] пустой результат за период', startDate, endDate);
      return;
    }
    const b = rows[0];
    const restCount = +b.rest_count || 0;

    // Fallback: если в расчёте меньше 3 ресторанов — данные ненадёжны,
    // оставляем NET и TOP10 нулевыми, UI покажет прочерки вместо метрик сети.
    if (restCount < 3) {
      console.warn('[benchmarks] недостаточно ресторанов для сравнения:', restCount);
      NET.restCount = restCount;
      return;
    }

    NET.revenue    = Math.round(+b.rev_median);
    NET.avgCheck   = Math.round(+b.chk_median);
    NET.checks     = Math.round(+b.cnt_median);
    NET.foodcost   = +(+b.fc_median).toFixed(1);
    NET.discount   = +(+b.disc_median).toFixed(1);
    NET.deliveryPct= +(+b.del_median).toFixed(1);
    NET.restCount  = restCount;

    TOP10.revenue    = Math.round(+b.rev_p90);
    TOP10.avgCheck   = Math.round(+b.chk_p90);
    TOP10.foodcost   = +(+b.fc_p25).toFixed(1);
    TOP10.discount   = +(+b.disc_p25).toFixed(1);
    TOP10.deliveryPct= +(+b.del_p90).toFixed(1);
  } catch(e) {
    console.error('[benchmarks] ошибка загрузки:', e.message);
  }
}

// ═══ Like-for-like профили по дням недели ═══
// Загружают за последние 90 дней:
//  • профиль сети: "типичный понедельник / вторник / ... в сети"
//  • профиль выбранного ресторана: "наша норма понедельника / вторника / ..."
// ClickHouse toDayOfWeek() возвращает 1..7 (1=Пн..7=Вс, ISO).
async function loadDowProfiles(restaurantId) {
  const today = new Date().toISOString().slice(0,10);
  const d90 = new Date(Date.now()-90*864e5).toISOString().slice(0,10);

  // --- Профиль сети ---
  const sqlNet = \`
    SELECT
      toDayOfWeek(report_date) AS dow,
      quantile(0.50)(revenue_total_rub)    AS rev_p50,
      quantile(0.75)(revenue_total_rub)    AS rev_p75,
      quantile(0.50)(avg_check_total_rub)  AS chk_p50,
      quantile(0.75)(avg_check_total_rub)  AS chk_p75,
      quantile(0.50)(checks_total)         AS cnt_p50,
      quantile(0.75)(checks_total)         AS cnt_p75,
      quantile(0.50)(foodcost_total_pct)   AS fc_p50,
      quantile(0.25)(foodcost_total_pct)   AS fc_p25,
      quantile(0.50)(discount_total_pct)   AS disc_p50,
      quantile(0.25)(discount_total_pct)   AS disc_p25,
      quantile(0.50)(delivery_share_pct)   AS del_p50,
      quantile(0.75)(delivery_share_pct)   AS del_p75,
      count() AS n
    FROM chicko.mart_restaurant_daily_base
    WHERE report_date BETWEEN '\${d90}' AND '\${today}'
      AND is_anomaly_day = 0
      AND revenue_total_rub > 0
    GROUP BY dow
  \`;
  try {
    const rows = await fetchCK(sqlNet);
    NET_DOW = {};
    for (const r of rows) {
      NET_DOW[+r.dow] = {
        rev_p50:+r.rev_p50, rev_p75:+r.rev_p75,
        chk_p50:+r.chk_p50, chk_p75:+r.chk_p75,
        cnt_p50:+r.cnt_p50, cnt_p75:+r.cnt_p75,
        fc_p50:+r.fc_p50,   fc_p25:+r.fc_p25,
        disc_p50:+r.disc_p50, disc_p25:+r.disc_p25,
        del_p50:+r.del_p50, del_p75:+r.del_p75,
        n:+r.n
      };
    }
  } catch(e) {
    console.error('[dow-net] ошибка:', e.message);
    NET_DOW = {};
  }

  // --- Профиль ресторана ---
  if (!restaurantId) { MY_DOW={}; MY_DOW_DAYS=0; return; }
  const sqlMy = \`
    SELECT
      toDayOfWeek(report_date) AS dow,
      quantile(0.50)(revenue_total_rub)    AS rev_p50,
      quantile(0.50)(avg_check_total_rub)  AS chk_p50,
      quantile(0.50)(checks_total)         AS cnt_p50,
      quantile(0.50)(foodcost_total_pct)   AS fc_p50,
      quantile(0.50)(discount_total_pct)   AS disc_p50,
      quantile(0.50)(delivery_share_pct)   AS del_p50,
      count() AS n
    FROM chicko.mart_restaurant_daily_base
    WHERE dept_id = \${restaurantId}
      AND report_date BETWEEN '\${d90}' AND '\${today}'
      AND is_anomaly_day = 0
      AND revenue_total_rub > 0
    GROUP BY dow
  \`;
  try {
    const rows = await fetchCK(sqlMy);
    MY_DOW = {};
    let totalDays = 0;
    for (const r of rows) {
      MY_DOW[+r.dow] = {
        rev_p50:+r.rev_p50, chk_p50:+r.chk_p50, cnt_p50:+r.cnt_p50,
        fc_p50:+r.fc_p50, disc_p50:+r.disc_p50, del_p50:+r.del_p50,
        n:+r.n
      };
      totalDays += +r.n;
    }
    MY_DOW_DAYS = totalDays;
  } catch(e) {
    console.error('[dow-my] ошибка:', e.message);
    MY_DOW = {}; MY_DOW_DAYS = 0;
  }
}

// ═══ Like-for-like вычисления ═══
// Для массива точек ts (дни текущего периода) возвращает like-for-like
// бенчмарки: усреднение профилей сети и личных по dow, попадающим в этот период.
// Результат: { my: {rev,chk,cnt,fc,disc,del}, net_p50: {...}, net_p75: {...},
//              haveMy: bool, haveNet: bool, n_dow: Set }
function dowBenchmarks(ts) {
  const myAgg  = { rev:[], chk:[], cnt:[], fc:[], disc:[], del:[] };
  const netAgg = { rev:[], chk:[], cnt:[], fc:[], disc:[], del:[],
                   rev75:[], chk75:[], cnt75:[], fc25:[], disc25:[], del75:[] };
  const dowSet = new Set();
  for (const t of ts) {
    const jsDow = new Date(t.date).getDay(); // 0..6, 0=Sun
    const chDow = jsDow===0 ? 7 : jsDow;     // 1..7, ISO
    dowSet.add(chDow);
    const mp = MY_DOW[chDow];
    if (mp) {
      myAgg.rev.push(mp.rev_p50); myAgg.chk.push(mp.chk_p50); myAgg.cnt.push(mp.cnt_p50);
      myAgg.fc.push(mp.fc_p50);   myAgg.disc.push(mp.disc_p50); myAgg.del.push(mp.del_p50);
    }
    const np = NET_DOW[chDow];
    if (np) {
      netAgg.rev.push(np.rev_p50);   netAgg.chk.push(np.chk_p50); netAgg.cnt.push(np.cnt_p50);
      netAgg.fc.push(np.fc_p50);     netAgg.disc.push(np.disc_p50); netAgg.del.push(np.del_p50);
      netAgg.rev75.push(np.rev_p75); netAgg.chk75.push(np.chk_p75); netAgg.cnt75.push(np.cnt_p75);
      netAgg.fc25.push(np.fc_p25);   netAgg.disc25.push(np.disc_p25); netAgg.del75.push(np.del_p75);
    }
  }
  const mean = arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null;
  return {
    my: {
      rev:mean(myAgg.rev), chk:mean(myAgg.chk), cnt:mean(myAgg.cnt),
      fc:mean(myAgg.fc),   disc:mean(myAgg.disc), del:mean(myAgg.del),
    },
    net_p50: {
      rev:mean(netAgg.rev), chk:mean(netAgg.chk), cnt:mean(netAgg.cnt),
      fc:mean(netAgg.fc),   disc:mean(netAgg.disc), del:mean(netAgg.del),
    },
    net_p75: {
      rev:mean(netAgg.rev75), chk:mean(netAgg.chk75), cnt:mean(netAgg.cnt75),
      fc:mean(netAgg.fc25),   disc:mean(netAgg.disc25), del:mean(netAgg.del75),
    },
    haveMy: MY_DOW_DAYS >= 14,      // требование "нормы": ≥14 дней истории
    haveNet: Object.keys(NET_DOW).length > 0,
    dowCount: dowSet.size,
  };
}

function goTab(el) {
  document.querySelectorAll('.ntab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  el.classList.add('active');
  const tab = el.dataset.tab;
  document.getElementById('p-'+tab).classList.add('active');
  if(tab==='dynamics') renderDynamics();
  if(tab==='compare') renderCompare();
  if(tab==='analysis') renderAnalysis();
}

// ═══ FORECAST BLOCK (Phase 1.4, #71) ═══
// Алгоритм Г: текущий месяц (≥7 дней) → прошлый год × k → fallback 90-дневные DOW

function jsToChDow(jsDow) { return jsDow === 0 ? 7 : jsDow; }

function medianArr(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a,b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m-1] + s[m]) / 2;
}

function computeForecast(rest) {
  const maxDate = new Date(MAX_DATE);
  const year = maxDate.getFullYear();
  const month = maxDate.getMonth(); // 0-based
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthPrefix = \`\${year}-\${String(month+1).padStart(2,'0')}\`;
  const prevMonthPrefix = month === 0
    ? \`\${year-1}-12\`
    : \`\${year}-\${String(month).padStart(2,'0')}\`;
  const prevYearMonthPrefix = \`\${year-1}-\${String(month+1).padStart(2,'0')}\`;

  // Current month data
  const curData = rest.ts.filter(t => t.date.startsWith(monthPrefix));
  const curDates = new Set(curData.map(t => t.date));
  const actualTotal = curData.reduce((s, t) => s + t.revenue, 0);
  const daysElapsed = curData.length;

  // Build DOW medians from current month
  const curDowRevs = {};
  for (const t of curData) {
    const dow = jsToChDow(new Date(t.date).getDay());
    if (!curDowRevs[dow]) curDowRevs[dow] = [];
    curDowRevs[dow].push(t.revenue);
  }
  const curDowMedians = {};
  for (const [dow, vals] of Object.entries(curDowRevs)) {
    curDowMedians[+dow] = medianArr(vals);
  }

  // Previous year same month data + YoY coefficient
  const prevYearData = rest.ts.filter(t => t.date.startsWith(prevYearMonthPrefix));
  const prevYearDowRevs = {};
  for (const t of prevYearData) {
    const dow = jsToChDow(new Date(t.date).getDay());
    if (!prevYearDowRevs[dow]) prevYearDowRevs[dow] = [];
    prevYearDowRevs[dow].push(t.revenue);
  }
  const prevYearDowMedians = {};
  for (const [dow, vals] of Object.entries(prevYearDowRevs)) {
    prevYearDowMedians[+dow] = medianArr(vals);
  }

  // YoY coefficient from last complete month
  const prevMonthData = rest.ts.filter(t => t.date.startsWith(prevMonthPrefix));
  const prevMonthPYPrefix = month === 0
    ? \`\${year-2}-12\`
    : \`\${year-1}-\${String(month).padStart(2,'0')}\`;
  const prevMonthPYData = rest.ts.filter(t => t.date.startsWith(prevMonthPYPrefix));
  const prevMonthRev = prevMonthData.reduce((s,t) => s + t.revenue, 0);
  const prevMonthPYRev = prevMonthPYData.reduce((s,t) => s + t.revenue, 0);
  const yoyK = prevMonthPYRev > 0 ? prevMonthRev / prevMonthPYRev : 1;

  // Determine method & build DOW estimates
  let method = '';
  let dowEstimates = {};

  if (daysElapsed >= 7) {
    // Вариант А: текущий месяц
    method = 'медианы текущего месяца';
    dowEstimates = curDowMedians;
  } else if (prevYearData.length >= 7) {
    // Вариант Б: прошлый год × k
    method = \`по \${year-1} году (×\${yoyK.toFixed(2)})\`;
    for (const [dow, med] of Object.entries(prevYearDowMedians)) {
      dowEstimates[+dow] = med * yoyK;
    }
  } else {
    // Вариант В: 90-дневные DOW (fallback)
    method = 'DOW-профиль 90 дней';
    for (let d = 1; d <= 7; d++) {
      if (MY_DOW[d]) dowEstimates[d] = MY_DOW[d].rev_p50;
      else if (NET_DOW[d]) dowEstimates[d] = NET_DOW[d].rev_p50;
    }
  }

  // Build daily forecast array
  const dailyBars = [];
  let forecastRemaining = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = \`\${year}-\${String(month+1).padStart(2,'0')}-\${String(d).padStart(2,'0')}\`;
    const actual = curData.find(t => t.date === ds);
    if (actual) {
      dailyBars.push({ day: d, rev: actual.revenue, type: 'actual' });
    } else {
      const dow = jsToChDow(new Date(ds).getDay());
      const est = dowEstimates[dow] || 0;
      forecastRemaining += est;
      dailyBars.push({ day: d, rev: est, type: 'forecast' });
    }
  }

  // Previous full month total (for comparison)
  const prevMonthTotal = prevMonthData.reduce((s,t) => s + t.revenue, 0);

  return {
    actual: actualTotal,
    remaining: forecastRemaining,
    total: actualTotal + forecastRemaining,
    daysElapsed,
    daysInMonth,
    prevMonthTotal,
    yoyK,
    method,
    dailyBars,
    monthLabel: MNAMES_FULL[month] || '',
    year,
  };
}

function renderForecast() {
  const box = document.getElementById('forecastBox');
  if (!box || !R) { if(box) box.innerHTML = ''; return; }

  const fc = computeForecast(R);
  const label = NETWORK_MODE ? \`Вся сеть (\${RESTS.length} ресторанов)\` : R.name + ' (' + R.city + ')';

  const pct = fc.total > 0 ? Math.round(fc.actual / fc.total * 100) : 0;
  const vsPrev = fc.prevMonthTotal > 0 ? ((fc.total - fc.prevMonthTotal) / fc.prevMonthTotal * 100) : null;
  const maxBar = Math.max(...fc.dailyBars.map(b => b.rev), 1);

  const prevMonthIdx = (new Date(MAX_DATE).getMonth() - 1 + 12) % 12;
  const prevMonthName = MNAMES_FULL[prevMonthIdx] || '';

  box.innerHTML = \`<div class="fc-block">
    <div class="fc-hdr">
      <div class="fc-hdr-left">
        <span class="fc-lbl">Прогноз на \${fc.monthLabel}</span>
        <span class="fc-sub">\${label}</span>
      </div>
    </div>
    <div class="fc-row">
      <div>
        <div class="fc-big">\${fmtR(fc.total, true)}</div>
        <div class="fc-pair">
          <div class="fc-pair-item">
            <div class="fc-pair-lbl">Факт (1–\${fc.daysElapsed} \${fc.monthLabel.toLowerCase().slice(0,3)})</div>
            <div class="fc-pair-val" style="color:var(--text)">\${fmtR(fc.actual)}</div>
          </div>
          <div class="fc-pair-item">
            <div class="fc-pair-lbl">Прогноз (\${fc.daysElapsed+1}–\${fc.daysInMonth} \${fc.monthLabel.toLowerCase().slice(0,3)})</div>
            <div class="fc-pair-val" style="color:var(--text2)">\${fmtR(fc.remaining)}</div>
          </div>
        </div>
      </div>
      <div class="fc-side">
        <div class="fc-side-card">
          <div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px">Выполнение</div>
          <div style="font-family:'Cormorant Garamond',serif;font-size:20px;font-weight:700;color:\${pct >= 50 ? 'var(--green)' : 'var(--amber)'}">\${pct}%</div>
          <div class="fc-pbar"><div class="fc-pbar-fill" style="width:\${Math.min(pct,100)}%;background:\${pct >= 50 ? 'var(--green)' : 'var(--amber)'}"></div></div>
        </div>
        <div class="fc-side-card">
          <div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px">vs \${prevMonthName}</div>
          \${vsPrev !== null
            ? \`<div style="font-family:'Cormorant Garamond',serif;font-size:20px;font-weight:700;color:\${vsPrev >= 0 ? 'var(--green)' : 'var(--red)'}">\${vsPrev >= 0 ? '+' : ''}\${vsPrev.toFixed(1)}%</div>
               <div style="font-size:10px;color:var(--text3)">\${prevMonthName}: \${fmtR(fc.prevMonthTotal)}</div>\`
            : '<div style="font-size:12px;color:var(--text3)">нет данных</div>'
          }
        </div>
      </div>
    </div>
    <div class="fc-chart">\${fc.dailyBars.map(b =>
      \`<div class="fc-chart-bar" style="height:\${Math.max(b.rev / maxBar * 100, 2)}%;background:\${b.type === 'actual' ? 'var(--blue)' : 'rgba(212,168,75,.35)'};border:\${b.type === 'forecast' ? '1px dashed var(--gold)' : 'none'}"></div>\`
    ).join('')}</div>
    <div class="fc-chart-lbl"><span>1 \${fc.monthLabel.toLowerCase().slice(0,3)}</span><span style="color:var(--text2)">← факт | прогноз →</span><span>\${fc.daysInMonth} \${fc.monthLabel.toLowerCase().slice(0,3)}</span></div>
    <div class="fc-method">Метод: \${fc.method}</div>
  </div>\`;
}

function renderAll() {
  renderForecast();
  renderKPIs();
  renderMiniTrend();
  renderInsights();
  renderAlerts();
  // renderScore, renderDonut, renderGauge, renderRankBars — отключены
  // после разгрузки первого экрана. Функции сохранены в коде для
  // возможного возврата на другие вкладки в будущем.
}

// ═══ UTILS ═══
function fmtR(v,full) {
  if(v===null||v===undefined) return '—';
  const n=Math.abs(v);
  if(!full) {
    if(n>=1e6) return (v/1e6).toFixed(1)+'М₽';
    if(n>=100e3) return Math.round(v/1000)+'К₽';
    if(n>=10e3) return (v/1000).toFixed(1)+'К₽';
    if(n>=1e3) return (v/1000).toFixed(1)+'К₽';
  }
  return Math.round(v).toLocaleString('ru')+'₽';
}
function fmtN(v,d=1){return v===null||v===undefined?'—':Number(v).toFixed(d)}
function pctD(a,b){if(!b) return 0; return (a-b)/Math.abs(b)*100}
function dHtml(d,lb){
  if(isNaN(d)||Math.abs(d)<0.05) return '';
  const good=lb?d<0:d>0;
  return \`<span class="\${good?'up':'dn'}">\${good?'▲':'▼'} \${Math.abs(d).toFixed(1)}%</span>\`;
}
function getDOW(dateStr){return new Date(dateStr).getDay()} // 0=Sun
function isWeekend(dateStr){const d=getDOW(dateStr); return d===0||d===6}
function calcScore(r){
  const fc=r.foodcost!==null?r.foodcost:NET.foodcost;
  const dp=r.revenue>0?(r.delivery/r.revenue*100):0;
  return Math.round(
    Math.min(100,r.revenue/TOP10.revenue*100)*0.30+
    Math.max(0,100-(fc-19)*4)*0.25+
    Math.max(0,100-r.discount*5)*0.20+
    Math.min(100,dp/30*100)*0.15+
    Math.min(100,r.avgCheck/1800*100)*0.10
  );
}
function gradeInfo(s){
  if(s>=80) return{lbl:'Отличный результат',c:'#2ECC71'};
  if(s>=65) return{lbl:'Хороший уровень',c:'#D4A84B'};
  if(s>=50) return{lbl:'Средний уровень',c:'#F39C12'};
  return{lbl:'Требует внимания',c:'#E74C3C'};
}
function getTsRange(r,start,end){
  return r.ts.filter(t=>t.date>=start&&t.date<=end&&t.revenue>0);
}
function avgArr(arr){return arr.length?arr.reduce((a,b)=>a+b,0)/arr.length:0}
function safeAvg(ts,key){
  const vals=ts.map(t=>t[key]).filter(v=>v!==null&&v!==undefined&&!isNaN(v));
  return vals.length?vals.reduce((a,b)=>a+b,0)/vals.length:null;
}
function mkChart(id,cfg){
  const el=document.getElementById(id);
  if(!el) return;
  if(CHS[id]) CHS[id].destroy();
  CHS[id]=new Chart(el.getContext('2d'),cfg);
}
function deepClone(obj){return JSON.parse(JSON.stringify(obj))}
function chartOpts(yCb){
  const o=deepClone(CHART_OPTS);
  if(yCb) o.scales.y.ticks.callback=yCb;
  return o;
}

// ═══ CALENDAR PICKER ═══
const CAL_MODES = {}; // 'day' | 'month' | 'quarter' | 'year'
const MNAMES_SHORT = ['Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
const MNAMES_FULL = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

function buildCalendars(){
  const maxD=new Date(MAX_DATE||'2026-04-30');
  ['global'].forEach(key=>{ // Фаза 1.2: остался только глобальный календарь
    CAL_STATE[key]={start:MIN_DATE,end:MAX_DATE,picking:0,year:maxD.getFullYear(),month:maxD.getMonth()};
    CAL_MODES[key]='day';
    renderCal(key);
    updateCalLabel(key);
  });
}

function renderCal(key){
  const drop=document.getElementById(key+'CalDrop');
  if(!drop) return;
  const mode=CAL_MODES[key]||'day';
  const st=CAL_STATE[key];

  // — Mode tabs —
  const tabs=['day','month','quarter','year'];
  const tabLabels=['День','Месяц','Квартал','Год'];
  let html=\`<div style="display:flex;gap:2px;margin-bottom:10px;border-bottom:1px solid var(--border);padding-bottom:8px">\`;
  tabs.forEach((t,i)=>{
    const active=mode===t;
    html+=\`<button onclick="setCalMode('\${key}','\${t}',event)" style="flex:1;padding:5px 4px;border:none;border-radius:6px;font-size:11px;font-family:Inter,sans-serif;cursor:pointer;transition:all .15s;background:\${active?'var(--gold)':'transparent'};color:\${active?'#000':'var(--text2)'};font-weight:\${active?'600':'400'}">\${tabLabels[i]}</button>\`;
  });
  html+=\`</div>\`;

  if(mode==='day'){
    html+=renderDayGrid(key);
    html+=\`<div class="cal-presets" style="margin-top:8px">
      <button class="cal-preset" onclick="calPreset('\${key}','last7',event)">7 дней</button>
      <button class="cal-preset" onclick="calPreset('\${key}','last14',event)">14 дней</button>
      <button class="cal-preset" onclick="calPreset('\${key}','last30',event)">30 дней</button>
      <button class="cal-preset" onclick="calPreset('\${key}','all',event)">Весь период</button>
    </div>\`;
  } else if(mode==='month'){
    html+=renderMonthGrid(key);
  } else if(mode==='quarter'){
    html+=renderQuarterGrid(key);
  } else if(mode==='year'){
    html+=renderYearGrid(key);
  }

  html+=\`<button class="cal-apply" onclick="calApply('\${key}',event)">Применить</button>\`;
  drop.innerHTML=html;
}

function setCalMode(key,mode,ev){
  if(ev) ev.stopPropagation();
  CAL_MODES[key]=mode;
  renderCal(key);
}

function renderDayGrid(key){
  const st=CAL_STATE[key];
  const year=st.year, month=st.month;
  const firstDay=new Date(year,month,1).getDay();
  const dim=new Date(year,month+1,0).getDate();
  const dow=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
  let h=\`<div class="cal-hdr">
    <button class="cal-nav" onclick="calNav('\${key}',-1,event)">&#8249;</button>
    <span class="cal-month-lbl">\${MNAMES_FULL[month]} \${year}</span>
    <button class="cal-nav" onclick="calNav('\${key}',1,event)">&#8250;</button>
  </div>
  <div class="cal-dow-row">\${dow.map(d=>\`<div class="cal-dow">\${d}</div>\`).join('')}</div>
  <div class="cal-grid">\`;
  const off=(firstDay+6)%7;
  for(let i=0;i<off;i++) h+=\`<div class="cal-day empty"></div>\`;
  for(let d=1;d<=dim;d++){
    const ds=\`\${year}-\${String(month+1).padStart(2,'0')}-\${String(d).padStart(2,'0')}\`;
    const has=ALL_DATES.includes(ds);
    const inR=st.start&&st.end&&ds>=st.start&&ds<=st.end;
    const isEnd=ds===st.start||ds===st.end;
    let cls='cal-day'+((!has)?' no-data':isEnd?' range-start':inR?' in-range':' has-data');
    h+=\`<div class="\${cls}" onclick="calClick('\${key}','\${ds}',event)">\${d}</div>\`;
  }
  h+=\`</div>\`;
  return h;
}

function renderMonthGrid(key){
  const st=CAL_STATE[key];
  const years=[...new Set(ALL_DATES.map(d=>+d.slice(0,4)))].sort().reverse();
  if(!years.length) return '<div style="color:var(--text3);font-size:11px;padding:8px">Нет данных</div>';
  let h=\`<div style="overflow-y:auto;max-height:220px">\`;
  years.forEach(y=>{
    h+=\`<div style="display:flex;align-items:center;gap:4px;margin-bottom:6px">
      <div style="font-size:11px;font-weight:600;color:var(--text);width:36px">\${y}</div>\`;
    MNAMES_SHORT.forEach((mn,mi)=>{
      const first=\`\${y}-\${String(mi+1).padStart(2,'0')}-01\`;
      const last=\`\${y}-\${String(mi+1).padStart(2,'0')}-\${new Date(y,mi+1,0).getDate()}\`;
      const hasData=ALL_DATES.some(d=>d.startsWith(\`\${y}-\${String(mi+1).padStart(2,'0')}\`));
      const selected=st.start<=last&&st.end>=first&&hasData;
      h+=\`<button onclick="calPickMonth('\${key}',\${y},\${mi},event)" style="flex:1;padding:4px 2px;border:1px solid \${selected?'var(--gold)':'var(--border)'};border-radius:5px;font-size:10px;font-family:Inter,sans-serif;cursor:\${hasData?'pointer':'default'};background:\${selected?'var(--gold)':hasData?'transparent':'rgba(0,0,0,0.2)'};color:\${selected?'#000':hasData?'var(--text)':'var(--text3)'}">\${mn}</button>\`;
    });
    h+=\`</div>\`;
  });
  h+=\`</div>\`;
  return h;
}

function renderQuarterGrid(key){
  const st=CAL_STATE[key];
  const years=[...new Set(ALL_DATES.map(d=>+d.slice(0,4)))].sort().reverse();
  let h=\`<div style="overflow-y:auto;max-height:220px">\`;
  years.forEach(y=>{
    h+=\`<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
      <div style="font-size:11px;font-weight:600;color:var(--text);width:36px">\${y}</div>\`;
    [0,1,2,3].forEach(q=>{
      const qStart=\`\${y}-\${String(q*3+1).padStart(2,'0')}-01\`;
      const qEnd=\`\${y}-\${String(q*3+3).padStart(2,'0')}-\${new Date(y,q*3+3,0).getDate()}\`;
      const hasData=ALL_DATES.some(d=>d>=qStart&&d<=qEnd);
      const selected=st.start<=qEnd&&st.end>=qStart&&hasData;
      h+=\`<button onclick="calPickQuarter('\${key}',\${y},\${q},event)" style="flex:1;padding:5px 4px;border:1px solid \${selected?'var(--gold)':'var(--border)'};border-radius:6px;font-size:11px;font-family:Inter,sans-serif;cursor:\${hasData?'pointer':'default'};background:\${selected?'var(--gold)':hasData?'transparent':'rgba(0,0,0,0.15)'};color:\${selected?'#000':hasData?'var(--text)':'var(--text3)'};font-weight:\${selected?'600':'400'}">Q\${q+1}</button>\`;
    });
    h+=\`</div>\`;
  });
  h+=\`</div>\`;
  return h;
}

function renderYearGrid(key){
  const st=CAL_STATE[key];
  const years=[...new Set(ALL_DATES.map(d=>+d.slice(0,4)))].sort().reverse();
  let h=\`<div style="display:flex;flex-wrap:wrap;gap:6px;padding:4px 0">\`;
  years.forEach(y=>{
    const first=\`\${y}-01-01\`, last=\`\${y}-12-31\`;
    const selected=st.start<=last&&st.end>=first;
    h+=\`<button onclick="calPickYear('\${key}',\${y},event)" style="padding:7px 14px;border:1px solid \${selected?'var(--gold)':'var(--border)'};border-radius:7px;font-size:12px;font-family:Inter,sans-serif;cursor:pointer;background:\${selected?'var(--gold)':'transparent'};color:\${selected?'#000':'var(--text)'};font-weight:\${selected?'600':'400'}">\${y}</button>\`;
  });
  h+=\`</div>\`;
  return h;
}

function calPickMonth(key,y,m,ev){
  if(ev) ev.stopPropagation();
  const st=CAL_STATE[key];
  const first=\`\${y}-\${String(m+1).padStart(2,'0')}-01\`;
  const last=\`\${y}-\${String(m+1).padStart(2,'0')}-\${new Date(y,m+1,0).getDate()}\`;
  if(st.picking===0){st.start=first;st.end=last;st.picking=1;renderCal(key);}
  else{
    if(first<st.start){st.end=st.end;st.start=first;}
    else{st.end=last;}
    st.picking=0;
    calApply(key,ev); // auto-apply
  }
}
function calPickQuarter(key,y,q,ev){
  if(ev) ev.stopPropagation();
  const st=CAL_STATE[key];
  const first=\`\${y}-\${String(q*3+1).padStart(2,'0')}-01\`;
  const last=\`\${y}-\${String(q*3+3).padStart(2,'0')}-\${new Date(y,q*3+3,0).getDate()}\`;
  st.start=first; st.end=last; st.picking=0;
  calApply(key,ev); // auto-apply
}
function calPickYear(key,y,ev){
  if(ev) ev.stopPropagation();
  const st=CAL_STATE[key];
  st.start=\`\${y}-01-01\`; st.end=\`\${y}-12-31\`; st.picking=0;
  calApply(key,ev); // auto-apply
}

function calNav(key,dir,ev){
  if(ev) ev.stopPropagation();
  const st=CAL_STATE[key];
  st.month+=dir;
  if(st.month>11){st.month=0;st.year++;}
  if(st.month<0){st.month=11;st.year--;}
  renderCal(key);
}
function toggleCal(key,ev){
  if(ev) ev.stopPropagation();
  const drop=document.getElementById(key+'CalDrop');
  const isOpen=drop.classList.contains('open');
  document.querySelectorAll('.cal-dropdown').forEach(d=>d.classList.remove('open'));
  if(!isOpen){drop.classList.add('open');renderCal(key);}
}
document.addEventListener('click',e=>{
  if(!e.target.closest('.cal-picker-wrap')) document.querySelectorAll('.cal-dropdown').forEach(d=>d.classList.remove('open'));
});
function calClick(key,ds,ev){
  if(ev) ev.stopPropagation();
  if(!ALL_DATES.includes(ds)) return;
  const st=CAL_STATE[key];
  if(st.picking===0){
    // Dblclick on same day = single-day select + apply
    if(st.start===ds && st.end===ds){calApply(key,ev);return;}
    st.start=ds;st.end=ds;st.picking=1;
    renderCal(key);
  } else {
    if(ds<st.start){st.end=st.start;st.start=ds;}
    else st.end=ds;
    st.picking=0;
    calApply(key,ev); // #69: auto-apply when range complete
  }
}
function calPreset(key,preset,ev){
  if(ev) ev.stopPropagation();
  const st=CAL_STATE[key];
  if(preset==='all'){st.start=MIN_DATE;st.end=MAX_DATE;}
  else if(preset==='last7'){st.start=ALL_DATES[Math.max(0,ALL_DATES.length-7)];st.end=MAX_DATE;}
  else if(preset==='last14'){st.start=ALL_DATES[Math.max(0,ALL_DATES.length-14)];st.end=MAX_DATE;}
  else if(preset==='last30'){st.start=ALL_DATES[Math.max(0,ALL_DATES.length-30)];st.end=MAX_DATE;}
  st.picking=0;
  calApply(key,ev); // #72: presets auto-apply
}
function fillCalPresets(){}

function calApply(key,ev){
  if(ev) ev.stopPropagation();
  const st=CAL_STATE[key];
  if(key==='global'){S.globalStart=st.start;S.globalEnd=st.end;}
  else if(key==='dyn'){S.dynStart=st.start;S.dynEnd=st.end;}
  else if(key==='cmp'){S.cmpStart=st.start;S.cmpEnd=st.end;}
  updateCalLabel(key);
  document.getElementById(key+'CalDrop').classList.remove('open');
  if(key==='global'){
    // При изменении глобального календаря синкаем периоды всех вкладок
    // (Фаза 1.2: один календарь на 4 вкладки, см. паспорт 5.28)
    S.dynStart = S.cmpStart = S.globalStart;
    S.dynEnd   = S.cmpEnd   = S.globalEnd;
    loadNetworkBenchmarks(S.globalStart, S.globalEnd).then(()=>{
      try {
        renderAll();
        // Перерисовываем всё, даже если сейчас видна другая вкладка
        if (typeof renderDynamics === 'function') renderDynamics();
        if (typeof renderCompare === 'function') renderCompare();
      } catch(e) {
        alert('Ошибка при применении дат:\\n'+e.message);
        console.error(e);
      }
    });
  }
}
function updateCalLabel(key){
  const st=CAL_STATE[key];
  const fmt=d=>{if(!d) return '';const dt=new Date(d);return dt.getDate()+' '+'янвфевмарапрмайиюниюлавгсеноктноядек'.match(/.{3}/g)[dt.getMonth()]};
  const lbl=document.getElementById(key+'CalLbl');
  if(lbl) lbl.textContent=fmt(st.start)+' — '+fmt(st.end);
  const gLbl=document.getElementById('globalCalLbl');
  if(key==='global'&&gLbl) gLbl.textContent=fmt(st.start)+' — '+fmt(st.end);
}
function getGlobalTs(){return getTsRange(R,S.globalStart,S.globalEnd)}

// ═══ ALERTS ═══
function renderAlerts(){
  const ts = getGlobalTs();
  if(!ts.length) return;

  const cur = {
    revenue:  safeAvg(ts,'revenue')||0,
    avgCheck: safeAvg(ts,'avgCheck')||0,
    checks:   safeAvg(ts,'checks')||0,
    foodcost: safeAvg(ts,'foodcost'),
    discount: safeAvg(ts,'discount')||0,
    delivery: safeAvg(ts,'delivery')||0,
  };
  const dp = cur.revenue>0 ? cur.delivery/cur.revenue*100 : 0;

  // Like-for-like бенчмарки
  const bm = dowBenchmarks(ts);
  const daysN = ts.length;
  const periodTxt = \`за \${daysN} \${daysN===1?'день':daysN<5?'дня':'дней'}\`;

  // Выбор базы для сравнения:
  // 1) если у точки есть "моя норма" — она. Это основная база.
  // 2) fallback: медиана сети.
  const cmpBase = bm.haveMy ? 'my' : (bm.haveNet ? 'net_p50' : null);
  const cmpLabel = bm.haveMy ? 'вашей нормы' : 'медианы сети';

  // Trend analysis: показываем только если период ≥ 7 дней
  const last3 = ts.slice(-3);
  const declining3 = daysN>=7 && last3.length>=3 && last3[0].revenue>last3[1].revenue && last3[1].revenue>last3[2].revenue;
  const growing3   = daysN>=7 && last3.length>=3 && last3[0].revenue<last3[1].revenue && last3[1].revenue<last3[2].revenue;

  const msgs = [];

  // ФУДКОСТ — без изменений по порогам (22% норма / 26% критично для Chicko),
  // но с добавлением периода и like-for-like сравнением
  if (cur.foodcost!==null && cur.foodcost>26) {
    msgs.push({c:'a-red', t:\`🔴 <b>Критический фудкост: \${fmtN(cur.foodcost)}%</b> — превышает норму 22% на \${fmtN(cur.foodcost-22)} п.п. (среднее \${periodTxt}). Потери ~\${fmtR((cur.foodcost-22)/100*cur.revenue)}/день.\`});
  } else if (cur.foodcost!==null && cur.foodcost>22) {
    msgs.push({c:'a-amber', t:\`⚠️ <b>Фудкост \${fmtN(cur.foodcost)}% выше нормы</b> (норма до 22%), среднее \${periodTxt}. Снижение до 22% высвободит ~\${fmtR((cur.foodcost-22)/100*cur.revenue)}/день.\`});
  }

  // Тренд
  if (declining3) {
    msgs.push({c:'a-red', t:\`📉 <b>Выручка снижается 3 последних дня.</b> \${last3.map(t=>fmtR(t.revenue)).join(' → ')}. Проверьте качество, сервис и операционные процессы.\`});
  } else if (growing3) {
    msgs.push({c:'a-green', t:\`📈 <b>Выручка растёт 3 последних дня.</b> \${last3.map(t=>fmtR(t.revenue)).join(' → ')}. Хорошая динамика — зафиксируйте что сработало.\`});
  }

  // Скидки — like-for-like
  if (cmpBase && cur.discount > bm[cmpBase].disc*1.4) {
    const base = bm[cmpBase].disc;
    const extraPct = cur.discount - base;
    msgs.push({c:'a-amber', t:\`🏷️ <b>Скидки \${fmtN(cur.discount,1)}% — в 1.4× выше \${cmpLabel} (\${fmtN(base,1)}%)</b>, \${periodTxt}. Потеря ~\${fmtR(cur.revenue*extraPct/100)}/день. Проверьте: акции возвращают гостей или просто режут маржу?\`});
  }

  // Доставка — like-for-like (если есть доставка у ресторана)
  if (cmpBase && bm[cmpBase].del>5 && dp < bm[cmpBase].del*0.6) {
    const base = bm[cmpBase].del;
    msgs.push({c:'a-amber', t:\`🛵 <b>Доставка \${fmtN(dp,1)}% выручки — в 2× ниже \${cmpLabel} (\${fmtN(base,1)}%)</b>, \${periodTxt}. Если догнать: ~\${fmtR((base-dp)/100*cur.revenue)}/день выручки от доставки.\`});
  }

  // Средний чек — like-for-like
  if (cmpBase && cur.avgCheck < bm[cmpBase].chk*0.85) {
    const base = bm[cmpBase].chk;
    msgs.push({c:'a-amber', t:\`🧾 <b>Средний чек \${fmtR(cur.avgCheck)} на \${fmtN(Math.abs(pctD(cur.avgCheck,base)))}% ниже \${cmpLabel} (\${fmtR(base)})</b>, \${periodTxt}. Работайте с допродажами и комбо-наборами.\`});
  }

  // Выручка — сравнение с топ-25% сети (если она выше) или с медианой
  if (bm.haveNet && cur.revenue > bm.net_p75.rev*0.95 && bm.net_p75.rev>0) {
    msgs.push({c:'a-green', t:\`🏆 <b>Выручка на уровне топ-25% сети!</b> \${fmtR(cur.revenue)}/день против \${fmtR(bm.net_p75.rev)}/день у лидеров (\${periodTxt}).\`});
  } else if (cmpBase && cur.revenue < bm[cmpBase].rev*0.7) {
    const base = bm[cmpBase].rev;
    msgs.push({c:'a-red', t:\`⬇️ <b>Выручка \${fmtR(cur.revenue)} — на \${fmtN(Math.abs(pctD(cur.revenue,base)))}% ниже \${cmpLabel} (\${fmtR(base)})</b>, \${periodTxt}. Это системный разрыв — нужен план действий.\`});
  }

  // Сортировка
  const order = {'a-red':0,'a-amber':1,'a-green':2,'a-blue':3};
  msgs.sort((a,b)=>(order[a.c]||9)-(order[b.c]||9));
  document.getElementById('alertsBox').innerHTML=msgs.slice(0,3).map(m=>\`<div class="alert \${m.c}">\${m.t}</div>\`).join('');
}


function setPeriod(p, btn) {
  S.analysisPeriod = p;
  document.querySelectorAll('#periodBtns .pbtn2').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  updatePeriodDesc();
  renderKPIs();
}
function setCompareTo(c, btn) {
  S.compareTo = c;
  document.querySelectorAll('#compareBtns .pbtn2').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  updatePeriodDesc();
  renderKPIs();
}
function updatePeriodDesc() {
  const pLabels = { day: 'день', week: 'неделю', month: 'месяц', quarter: 'квартал', year: 'год' };
  const prevLabels = { day: 'пред. день', week: 'пред. неделю', month: 'пред. месяц', quarter: 'пред. квартал', year: 'пред. год' };
  const cLabels = { prev: prevLabels[S.analysisPeriod]||'пред. период', network: 'средняя по сети', top10: 'лидеры сети' };
  const el = document.getElementById('periodDesc');
  if (el) el.textContent = 'Среднее за ' + pLabels[S.analysisPeriod] + ' / ' + cLabels[S.compareTo];
}
function getPeriodTs() {
  const all = getGlobalTs();
  if (!all.length) return { cur: [], prev: [] };
  const n = S.analysisPeriod === 'day' ? 1 : S.analysisPeriod === 'week' ? 7 : S.analysisPeriod === 'month' ? 30 : S.analysisPeriod === 'quarter' ? 90 : 365;
  const cur = all.slice(-n);
  const prev = all.slice(-n*2, -n);
  return { cur, prev };
}
function getCompareValue(curVal, prevTs, field, isInverse) {
  if (S.compareTo === 'prev') {
    if (!prevTs.length) return null;
    return safeAvg(prevTs, field);
  }
  if (S.compareTo === 'network') return field === 'revenue' ? NET.revenue : field === 'avgCheck' ? NET.avgCheck : field === 'checks' ? NET.checks : null;
  if (S.compareTo === 'top10') return field === 'revenue' ? TOP10.revenue : field === 'avgCheck' ? TOP10.avgCheck : null;
  return null;
}
function getCompareLabel() {
  if (S.compareTo === 'prev') return S.analysisPeriod === 'day' ? 'пред. день' : S.analysisPeriod === 'week' ? 'пред. неделя' : 'пред. месяц';
  if (S.compareTo === 'network') return 'vs сеть';
  return 'vs лидеры';
}

// ═══ KPIs ═══
function renderKPIs(){
  const ts = getGlobalTs();
  if(!ts.length) return;

  // Реальные средние за выбранный период
  const cur={
    revenue:  safeAvg(ts,'revenue')||0,
    avgCheck: safeAvg(ts,'avgCheck')||0,
    checks:   safeAvg(ts,'checks')||0,
    foodcost: safeAvg(ts,'foodcost'),
    discount: safeAvg(ts,'discount')||0,
    delivery: safeAvg(ts,'delivery')||0,
  };
  const dp = cur.revenue>0 ? cur.delivery/cur.revenue*100 : 0;

  // Like-for-like бенчмарки (моя норма + медиана сети + топ-25% сети) по dow
  const bm = dowBenchmarks(ts);

  // Главное сравнение — "vs моя норма" (если истории достаточно),
  // иначе fallback на "vs медиану сети".
  // Мелкая подпись показывает оба сетевых бенчмарка.
  //
  // Для foodcost/скидок: "меньше=лучше", поэтому в dHtml делаем lb=true (перевёртываем цвета).
  function renderCard(id, value, fmtFn, myVal, netP50, netP75, lessIsBetter, barFn) {
    const valEl = document.getElementById('kv-'+id);
    const delEl = document.getElementById('kd-'+id);
    const benEl = document.getElementById('kb-'+id);
    const barEl = document.getElementById('kr-'+id);
    if (!valEl) return;

    // Главное число
    valEl.innerHTML = fmtFn(value, true);

    // Главное сравнение: если есть "моя норма" — сравнение с ней,
    // иначе с медианой сети. Если и сети нет — прочерк.
    let mainCmp = '';
    if (bm.haveMy && myVal && myVal>0) {
      mainCmp = dHtml(pctD(value, myVal), lessIsBetter) + ' <span class="nt">vs моя норма</span>';
    } else if (bm.haveNet && netP50 && netP50>0) {
      mainCmp = dHtml(pctD(value, netP50), lessIsBetter) + ' <span class="nt">vs медиана сети</span>';
    }
    if (delEl) delEl.innerHTML = mainCmp;

    // Фоновый контекст: медиана сети + топ-25% сети
    // Если есть "моя норма" — показываем её отдельной строкой в первой позиции
    const parts = [];
    if (bm.haveMy && myVal && myVal>0)   parts.push('моя норма ' + fmtFn(myVal));
    if (bm.haveNet && netP50 && netP50>0) parts.push('сеть ' + fmtFn(netP50));
    if (bm.haveNet && netP75 && netP75>0) {
      const label = lessIsBetter ? 'топ-25% ≤ ' : 'топ-25% ≥ ';
      parts.push(label + fmtFn(netP75));
    }
    if (benEl) benEl.innerHTML = parts.join(' · ');

    // Прогресс-бар — относительно топ-25% (если есть)
    if (barEl && barFn) {
      const pct = barFn(value, netP75, netP50);
      barEl.style.width = Math.min(100, Math.max(0, pct)) + '%';
    }
  }

  // Helpers
  const fmtR_short = (v) => fmtR(v);
  const fmtR_full  = (v) => fmtR(v, true);
  const fmtPct1 = (v) => v==null ? '—' : fmtN(v, 1) + '%';
  const fmtInt  = (v) => v==null ? '—' : Math.round(v) + ' чек';

  renderCard('rev', cur.revenue,  fmtR_short, bm.my.rev,  bm.net_p50.rev,  bm.net_p75.rev,  false,
             (v,p75,p50) => p75 ? (v/p75)*100 : (p50 ? (v/p50)*60 : 0));
  renderCard('chk', cur.avgCheck, fmtR_full,  bm.my.chk,  bm.net_p50.chk,  bm.net_p75.chk,  false,
             (v,p75,p50) => p75 ? (v/p75)*100 : (p50 ? (v/p50)*60 : 0));
  renderCard('cnt', cur.checks,   fmtInt,     bm.my.cnt,  bm.net_p50.cnt,  bm.net_p75.cnt,  false,
             (v,p75,p50) => p75 ? (v/p75)*100 : (p50 ? (v/p50)*60 : 0));

  // Foodcost — цвет по порогам (22% / 26%)
  if (cur.foodcost !== null) {
    const fc = cur.foodcost;
    const fcColor = fc>26 ? 'var(--red)' : fc>22 ? 'var(--amber)' : 'var(--green)';
    const fcBarCls = fc>26 ? 'br' : fc>22 ? 'ba' : 'bg';
    const el = document.getElementById('kv-fc');
    if (el) el.style.color = fcColor;
    const barEl = document.getElementById('kr-fc');
    if (barEl) barEl.className = 'kbar ' + fcBarCls;
    renderCard('fc', fc, fmtPct1, bm.my.fc, bm.net_p50.fc, bm.net_p75.fc, true,
               (v) => Math.min(100, v/35*100));
  }

  renderCard('disc', cur.discount, fmtPct1, bm.my.disc, bm.net_p50.disc, bm.net_p75.disc, true,
             (v) => Math.min(100, v*5));
  const discColor = cur.discount > (bm.net_p50.disc||3.3)*1.4 ? 'var(--red)' :
                    cur.discount > (bm.net_p50.disc||3.3)     ? 'var(--amber)' : 'var(--text)';
  const discEl = document.getElementById('kv-disc');
  if (discEl) discEl.style.color = discColor;

  renderCard('del', dp, fmtPct1, bm.my.del, bm.net_p50.del, bm.net_p75.del, false,
             (v) => Math.min(100, v/40*100));
}
function setKPI(id,raw,fmt,unit,prevRaw,netBench,lb,benchLbl,barPct,barCls){
  document.getElementById('kv-'+id).innerHTML=fmt+(unit?\`<span class="u">\${unit}</span>\`:'');
  if(prevRaw!==null&&prevRaw!==undefined) document.getElementById('kd-'+id).innerHTML=dHtml(pctD(raw,prevRaw),lb)+' <span class="nt">'+(typeof getCompareLabel==='function'?getCompareLabel():'пред. день')+'</span>';
  if(benchLbl) document.getElementById('kb-'+id).textContent='Сеть: '+benchLbl;
  document.getElementById('kr-'+id).className='kbar '+(barCls||'bgo');
  document.getElementById('kr-'+id).style.width=Math.min(100,barPct||0)+'%';
}

// ═══ SCORE ═══
function renderScore(){
  // Функция сохранена для возможного возврата. Если DOM-элементов нет — выходим.
  if (!document.getElementById('scoreRing')) return;
  // Recalculate score dynamically from selected period's data
  const ts = getGlobalTs();
  let score, dispRank, rankN;
  if(ts.length>0) {
    // Calc score from period ts for current restaurant
    const rev=safeAvg(ts,'revenue')||0;
    const fc=safeAvg(ts,'foodcost')||NET.foodcost;
    const chk=safeAvg(ts,'avgCheck')||NET.avgCheck;
    const cnt=safeAvg(ts,'checks')||NET.checks;
    const disc=safeAvg(ts,'discount')||NET.discount;
    const dp=safeAvg(ts,'deliveryPct')||(rev>0?safeAvg(ts,'delivery')/rev*100:0)||0;
    score = Math.min(100,Math.round(
      Math.min(100,rev/(TOP10.revenue||1)*100)*0.25+
      Math.max(0,100-(fc-19)*5)*0.20+
      Math.min(100,cnt/(NET.checks||1)*100)*0.15+
      Math.min(100,chk/(NET.avgCheck||1)*100)*0.10+
      Math.max(0,100-disc*4)*0.10+
      Math.min(100,dp/30*100)*0.10+
      Math.min(100,Math.max(0,((rev*(1-disc/100)*(1-fc/100)-rev*(1-disc/100)*0.40)/(rev*(1-disc/100)||1))*100))*0.10
    ));
    // Rank among all rests for same period
    const allScores=RESTS.map(r2=>{
      const ts2=r2.ts.filter(t=>t.date>=S.globalStart&&t.date<=S.globalEnd);
      if(!ts2.length) return {name:r2.name,score:0};
      const rev2=safeAvg(ts2,'revenue')||0;
      const fc2=safeAvg(ts2,'foodcost')||NET.foodcost;
      const cnt2=safeAvg(ts2,'checks')||NET.checks;
      const chk2=safeAvg(ts2,'avgCheck')||NET.avgCheck;
      const disc2=safeAvg(ts2,'discount')||NET.discount;
      const dp2=safeAvg(ts2,'deliveryPct')||(rev2>0?(safeAvg(ts2,'delivery')||0)/rev2*100:0)||0;
      return {name:r2.name,score:Math.min(100,Math.round(
        Math.min(100,rev2/(TOP10.revenue||1)*100)*0.25+
        Math.max(0,100-(fc2-19)*5)*0.20+
        Math.min(100,cnt2/(NET.checks||1)*100)*0.15+
        Math.min(100,chk2/(NET.avgCheck||1)*100)*0.10+
        Math.max(0,100-disc2*4)*0.10+
        Math.min(100,dp2/30*100)*0.10+0.10
      ))};
    }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score);
    dispRank=(allScores.findIndex(x=>x.name===R.name)+1)||1;
    rankN=allScores.length;
  } else {
    score = RESTAURANT_SCORE ? Math.round(+RESTAURANT_SCORE.score_total) : calcScore(R);
    rankN = RESTAURANT_SCORE ? +RESTAURANT_SCORE.restaurants_in_rank : RESTS.filter(r=>r.revenue>0).length;
    dispRank = RESTAURANT_SCORE ? +RESTAURANT_SCORE.rank_network : 1;
  }
  const g=gradeInfo(score);
  document.getElementById('scoreN').textContent=score;
  document.getElementById('scoreN').style.color=g.c;
  document.getElementById('scoreG').textContent=g.lbl;
  document.getElementById('scoreG').style.color=g.c;
  document.getElementById('chipScore').textContent=score;
  document.getElementById('chipGrade').textContent=g.lbl;
  document.getElementById('chipGrade').style.color=g.c;
  document.getElementById('scoreP').textContent=\`#\${dispRank} из \${rankN} точек\`;
  document.getElementById('rankBadge').textContent=dispRank;
  document.getElementById('rankTot').textContent=rankN;
  document.getElementById('rankPct').textContent='Топ '+Math.round(dispRank/rankN*100)+'% сети';
  const c=document.getElementById('scoreRing').getContext('2d');
  c.clearRect(0,0,144,144);
  const cx=72,cy=72,rad=60,lw=9;
  c.beginPath();c.arc(cx,cy,rad,-Math.PI*.8,Math.PI*.8);c.strokeStyle='#2E4068';c.lineWidth=lw;c.lineCap='round';c.stroke();
  const end=-Math.PI*.8+(score/100)*Math.PI*1.6;
  const grd=c.createLinearGradient(0,0,144,144);grd.addColorStop(0,g.c);grd.addColorStop(1,'#F0C96A');
  c.beginPath();c.arc(cx,cy,rad,-Math.PI*.8,end);c.strokeStyle=grd;c.lineWidth=lw;c.lineCap='round';c.stroke();
  const ck=RESTAURANT_SCORE;
  const fc=R.foodcost!==null?R.foodcost:NET.foodcost;
  const dp=R.revenue>0?R.delivery/R.revenue*100:0;
  const parts=ck?[
    {l:'Выручка',s:Math.round(+ck.score_revenue*.25),m:25,c:'#D4A84B'},
    {l:'Фудкост',s:Math.round(+ck.score_foodcost*.20),m:20,c:'#2ECC71'},
    {l:'Трафик',s:Math.round(+ck.score_traffic*.15),m:15,c:'#4A9EF5'},
    {l:'Ср. чек',s:Math.round(+ck.score_avg_check*.10),m:10,c:'#9B59B6'},
    {l:'Скидки',s:Math.round(+ck.score_discount*.10),m:10,c:'#F39C12'},
    {l:'Доставка',s:Math.round(+ck.score_delivery*.10),m:10,c:'#1ABC9C'},
  ]:[
    {l:'Выручка',s:Math.round(Math.min(100,R.revenue/TOP10.revenue*100)*.30),m:30,c:'#D4A84B'},
    {l:'Фудкост',s:Math.round(Math.max(0,100-(fc-19)*4)*.25),m:25,c:'#2ECC71'},
    {l:'Скидки',s:Math.round(Math.max(0,100-R.discount*5)*.20),m:20,c:'#4A9EF5'},
    {l:'Доставка',s:Math.round(Math.min(100,dp/30*100)*.15),m:15,c:'#1ABC9C'},
    {l:'Ср. чек',s:Math.round(Math.min(100,R.avgCheck/1800*100)*.10),m:10,c:'#9B59B6'},
  ];
  document.getElementById('scoreBr').innerHTML=parts.map(p=>\`<div class="sbr-row"><span class="sbr-lbl">\${p.l}</span><div class="sbr-t"><div class="sbr-f" style="width:\${p.m?p.s/p.m*100:0}%;background:\${p.c}"></div></div><span class="sbr-v" style="color:var(--text2);font-size:10px">\${p.m?Math.round(p.s/p.m*100):0}%</span></div>\`).join('');
}


// ═══ MINI TREND ═══
function renderMiniTrend(){
  // For "day" period show last 7 days for context, else use selected period
  const ts = S.analysisPeriod==='day' ? getGlobalTs().slice(-7) : getGlobalTs();
  mkChart('miniC',{type:'line',data:{labels:ts.map(t=>t.date.slice(5)),datasets:[{data:ts.map(t=>t.revenue),borderColor:'#D4A84B',backgroundColor:'rgba(212,168,75,.07)',borderWidth:2,pointRadius:2,fill:true,tension:.3},{data:ts.map(()=>NET.revenue),borderColor:'rgba(142,170,206,.3)',borderDash:[4,4],borderWidth:1.5,pointRadius:0,fill:false,label:'Сеть'}]},options:{...chartOpts(v=>fmtR(v)),plugins:{legend:{display:false}}}});
}

// ═══ DONUT ═══
function renderDonut(){
  if (!document.getElementById('donutC')) return;
  const ts=getGlobalTs();
  const bar=safeAvg(ts,'bar')||0,kit=safeAvg(ts,'kitchen')||0,del=safeAvg(ts,'delivery')||0;
  const rev=safeAvg(ts,'revenue')||R.revenue||1;
  const vals=[],lbls=[],cols=[];
  if(bar>0){vals.push(bar);lbls.push('Бар');cols.push('#D4A84B')}
  if(kit>0){vals.push(kit);lbls.push('Кухня');cols.push('#4A9EF5')}
  if(del>0){vals.push(del);lbls.push('Доставка');cols.push('#2ECC71')}
  if(!vals.length){vals.push(rev);lbls.push('Выручка');cols.push('#D4A84B')}
  mkChart('donutC',{type:'doughnut',data:{labels:lbls,datasets:[{data:vals,backgroundColor:cols,borderColor:'#1E2D47',borderWidth:3}]},options:{responsive:true,maintainAspectRatio:false,cutout:'70%',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>\`\${c.label}: \${fmtR(c.raw)} (\${(c.raw/rev*100).toFixed(1)}%)\`}}}}});
  document.getElementById('donutLeg').innerHTML=lbls.map((l,i)=>\`<div class="dl-row"><div class="dl-dot" style="background:\${cols[i]}"></div><span class="dl-name">\${l}</span><span class="dl-pct">\${(vals[i]/rev*100).toFixed(1)}%</span><span class="dl-val">\${fmtR(vals[i])}</span></div>\`).join('');
}

// ═══ GAUGE ═══
function renderGauge(){
  if (!document.getElementById('gaugeC')) return;
  const ts=getGlobalTs();
  const fc=safeAvg(ts,'foodcost');
  if(fc===null){const gv=document.getElementById('gaugeVal');if(gv)gv.textContent='—';return}
  const cv=document.getElementById('gaugeC').getContext('2d');
  const W=200,H=110;
  cv.clearRect(0,0,W,H);
  const cx=100,cy=98,rad=82,lw=14;
  // Zones
  [{f:0,t:22/40,c:'#27AE60'},{f:22/40,t:26/40,c:'#F39C12'},{f:26/40,t:1,c:'#E74C3C'}].forEach(z=>{
    cv.beginPath();cv.arc(cx,cy,rad,Math.PI+z.f*Math.PI,Math.PI+z.t*Math.PI);cv.strokeStyle=z.c;cv.lineWidth=lw;cv.lineCap='butt';cv.stroke();
  });
  // Tick marks
  [19,22,26,35].forEach(v=>{
    const a=Math.PI+Math.min(1,v/40)*Math.PI;
    const x1=cx+Math.cos(a)*(rad-lw/2-2),y1=cy+Math.sin(a)*(rad-lw/2-2);
    const x2=cx+Math.cos(a)*(rad+lw/2+2),y2=cy+Math.sin(a)*(rad+lw/2+2);
    cv.beginPath();cv.moveTo(x1,y1);cv.lineTo(x2,y2);cv.strokeStyle='rgba(0,0,0,0.4)';cv.lineWidth=1.5;cv.stroke();
  });
  // Needle — shorter so it doesn't reach center text
  const na=Math.PI+Math.min(1,Math.max(0,fc/40))*Math.PI;
  const needleLen=rad-lw-6;
  cv.beginPath();cv.moveTo(cx,cy);cv.lineTo(cx+Math.cos(na)*needleLen,cy+Math.sin(na)*needleLen);
  cv.strokeStyle='#fff';cv.lineWidth=2;cv.lineCap='round';cv.stroke();
  // Center dot
  cv.beginPath();cv.arc(cx,cy,6,0,Math.PI*2);cv.fillStyle='#fff';cv.fill();
  cv.beginPath();cv.arc(cx,cy,3,0,Math.PI*2);cv.fillStyle='#1C2742';cv.fill();
  // NO text on canvas — displayed in HTML below gauge to avoid needle overlap
  const col=fc>26?'#E74C3C':fc>22?'#F39C12':'#27AE60';
  const gaugeVal=document.getElementById('gaugeVal');
  if(gaugeVal){gaugeVal.textContent=fmtN(fc)+'%';gaugeVal.style.color=col;}
  // gaugeN removed from DOM
  document.getElementById('gaugeZ').textContent=fc<=22?'✅ Норма':fc<=26?'⚠️ Умеренный — есть резервы':'🔴 Высокий — нужны меры!';
  document.getElementById('gaugeZ').style.color=col;
}

// ═══ RANK BARS ═══
function renderRankBars(){
  if (!document.getElementById('rankBars')) return;
  // Calculate period avg revenue for each restaurant
  const withRev = RESTS.map(r2=>{
    const ts2 = r2.ts.filter(t=>t.date>=S.globalStart&&t.date<=S.globalEnd&&t.revenue>0);
    const avgRev = ts2.length ? ts2.reduce((s,t)=>s+t.revenue,0)/ts2.length : 0;
    return {r:r2, avgRev};
  }).filter(x=>x.avgRev>0).sort((a,b)=>b.avgRev-a.avgRev);
  const max = withRev[0]?.avgRev||1;
  document.getElementById('rankBars').innerHTML=withRev.map(({r:r2,avgRev},i)=>{
    const me=r2.name===R.name;
    const ridx=RESTS.findIndex(r=>r.name===r2.name);
    return \`<div class="rbar-row \${me?'me':''}" style="cursor:\${me?'default':'pointer'};transition:opacity .15s" \${me?'':'onclick="selectRest('+ridx+')"'}>
      <div class="rbar-name \${me?'me':''}" title="\${r2.name}">\${i+1}. \${r2.name.replace('Чико (','').replace(')','').replace('Чико Рико ','Рико ').slice(0,22)}</div>
      <div class="rbar-t"><div class="rbar-f" style="width:\${avgRev/max*100}%;background:\${me?'var(--gold)':'var(--border2)'}"></div></div>
      <div class="rbar-v">\${fmtR(avgRev)}</div>
    </div>\`;
  }).join('');
}

// ═══ INSIGHTS ═══
function renderInsights(){
  const ts = getGlobalTs();
  if (!ts.length) return;
  const box = document.getElementById('insBox');
  if (!box) return;

  const cur = {
    revenue:  safeAvg(ts,'revenue')||0,
    avgCheck: safeAvg(ts,'avgCheck')||0,
    checks:   safeAvg(ts,'checks')||0,
    foodcost: safeAvg(ts,'foodcost'),
    discount: safeAvg(ts,'discount')||0,
    delivery: safeAvg(ts,'delivery')||0,
  };
  const dp = cur.revenue>0 ? cur.delivery/cur.revenue*100 : 0;

  const bm = dowBenchmarks(ts);
  const daysN = ts.length;
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();

  // Умная логика карточек:
  // - если у нас есть "моя норма" — сравниваем с ней (главное сравнение)
  // - дополнительно показываем где мы относительно сети (p50 и p75)
  // - цвет: red / amber / green в зависимости от отклонения
  // - денежная оценка — диапазон (60-100%) с контекстом
  const ins = [];

  // Helper: умная карточка для одной метрики
  // kind='revenue'|'avgCheck'|'foodcost'|'discount'|'delivery'
  // higherIsBetter: true для выручки, чека, доставки; false для foodcost, discount
  function buildCard(cfg) {
    const { icon, name, value, myNorm, netP50, netP75,
            higherIsBetter, unit, fmt, monthImpactFn } = cfg;
    if (value == null) return null;

    // Определяем "здоровье" метрики
    let tone = 'blue'; // neutral default
    let headline = '';
    let body = '';
    let action = null;

    if (bm.haveMy && myNorm && myNorm > 0) {
      const diffPct = (value - myNorm) / myNorm * 100;
      const better = higherIsBetter ? diffPct > 0 : diffPct < 0;
      const magnitude = Math.abs(diffPct);

      if (magnitude < 5) {
        tone = 'green';
        headline = \`\${name} \${fmt(value)} — в вашей норме\`;
        body = \`Ваша норма по таким дням: \${fmt(myNorm)}\${unit||''}. Разница \${fmtN(diffPct,1)}%.\`;
      } else if (better) {
        tone = 'green';
        headline = \`\${name} \${fmt(value)} — лучше вашей нормы на \${fmtN(magnitude,1)}%\`;
        body = \`Ваша норма \${fmt(myNorm)}\${unit||''}. Зафиксируйте что сработало.\`;
      } else {
        tone = magnitude > 15 ? 'red' : 'amber';
        headline = \`\${name} \${fmt(value)} — хуже вашей нормы на \${fmtN(magnitude,1)}%\`;
        body = \`Ваша норма по таким дням: \${fmt(myNorm)}\${unit||''}.\`;
        // Контекст сети
        if (bm.haveNet && netP50) {
          const vsNet = (value - netP50)/netP50*100;
          const vsNetBetter = higherIsBetter ? vsNet > 0 : vsNet < 0;
          if (vsNetBetter) {
            body += \` При этом по сети вы всё ещё \${higherIsBetter?'выше':'лучше'} медианы (\${fmt(netP50)}).\`;
          } else {
            body += \` И ниже медианы сети (\${fmt(netP50)}).\`;
          }
        }
        // Денежный эффект при возврате к норме
        if (monthImpactFn) {
          const impactMax = monthImpactFn(value, myNorm);
          if (impactMax > 0) {
            const impactMin = Math.round(impactMax * 0.6);
            action = \`≈ \${fmtR(impactMin)}–\${fmtR(impactMax)}/мес, если вернётесь к своей норме\`;
          }
        }
      }
    } else if (bm.haveNet && netP50 && netP50 > 0) {
      // Fallback: нет своей нормы, сравниваем с сетью
      const diffPct = (value - netP50) / netP50 * 100;
      const better = higherIsBetter ? diffPct > 0 : diffPct < 0;
      const magnitude = Math.abs(diffPct);

      if (better) {
        tone = 'green';
        headline = \`\${name} \${fmt(value)} — выше медианы сети на \${fmtN(magnitude,1)}%\`;
        body = \`Медиана сети \${fmt(netP50)}\${unit||''} за такие же дни недели.\`;
        if (netP75 && (higherIsBetter ? value < netP75 : value > netP75)) {
          const gap = higherIsBetter ? netP75 - value : value - netP75;
          body += \` До топ-25% сети: \${fmt(Math.abs(gap))}\${unit||''}.\`;
        }
      } else {
        tone = magnitude > 15 ? 'red' : 'amber';
        headline = \`\${name} \${fmt(value)} — ниже медианы сети на \${fmtN(magnitude,1)}%\`;
        body = \`Медиана сети \${fmt(netP50)}\${unit||''} за такие же дни недели.\`;
        if (monthImpactFn) {
          const impactMax = monthImpactFn(value, netP50);
          if (impactMax > 0) {
            const impactMin = Math.round(impactMax * 0.6);
            action = \`≈ \${fmtR(impactMin)}–\${fmtR(impactMax)}/мес, если догоните медиану сети\`;
          }
        }
      }
    } else {
      return null; // нет данных для сравнения
    }

    return { t:tone, i:icon, h:headline, b:body, a:action };
  }

  // Выручка
  ins.push(buildCard({
    icon:'💰', name:'Выручка', value:cur.revenue,
    myNorm:bm.my.rev, netP50:bm.net_p50.rev, netP75:bm.net_p75.rev,
    higherIsBetter:true, unit:'', fmt:v=>fmtR(v),
    monthImpactFn: (val, target) => Math.round((target-val)*daysInMonth)
  }));

  // Средний чек
  ins.push(buildCard({
    icon:'🧾', name:'Средний чек', value:cur.avgCheck,
    myNorm:bm.my.chk, netP50:bm.net_p50.chk, netP75:bm.net_p75.chk,
    higherIsBetter:true, unit:'', fmt:v=>fmtR(v,true),
    monthImpactFn: (val, target) => Math.round((target-val)*cur.checks*daysInMonth)
  }));

  // Foodcost
  if (cur.foodcost !== null) {
    ins.push(buildCard({
      icon:'🥩', name:'Фудкост', value:cur.foodcost,
      myNorm:bm.my.fc, netP50:bm.net_p50.fc, netP75:bm.net_p75.fc,
      higherIsBetter:false, unit:'%', fmt:v=>fmtN(v,1),
      monthImpactFn: (val, target) => {
        // Снижение фудкоста с val до target экономит (val-target)% от выручки
        const net_rub = cur.revenue * (1 - cur.discount/100);
        return Math.round(net_rub * (val-target)/100 * daysInMonth);
      }
    }));
  }

  // Скидки
  ins.push(buildCard({
    icon:'🏷️', name:'Скидки', value:cur.discount,
    myNorm:bm.my.disc, netP50:bm.net_p50.disc, netP75:bm.net_p75.disc,
    higherIsBetter:false, unit:'%', fmt:v=>fmtN(v,1),
    monthImpactFn: (val, target) => Math.round(cur.revenue*(val-target)/100*daysInMonth)
  }));

  // Доставка — показываем только если у ресторана есть доставка (>1%)
  if (dp > 1) {
    ins.push(buildCard({
      icon:'🛵', name:'Доставка', value:dp,
      myNorm:bm.my.del, netP50:bm.net_p50.del, netP75:bm.net_p75.del,
      higherIsBetter:true, unit:'%', fmt:v=>fmtN(v,1),
      monthImpactFn: (val, target) => Math.round(cur.revenue*(target-val)/100*daysInMonth)
    }));
  }

  // DOW-анализ: показываем только если период ≥ 14 дней и каждый день ≥ 2 точек
  if (daysN >= 14) {
    const byDow = {};
    ts.forEach(t => {
      const d = getDOW(t.date);
      if (!byDow[d]) byDow[d] = [];
      byDow[d].push(t.revenue);
    });
    const dowEntries = Object.entries(byDow)
      .map(([d,v]) => ({d:+d, avg:avgArr(v), n:v.length}))
      .filter(x => x.n >= 2)
      .sort((a,b) => b.avg - a.avg);
    if (dowEntries.length >= 2) {
      const best = dowEntries[0], worst = dowEntries[dowEntries.length-1];
      if (best.d !== worst.d && best.avg > worst.avg * 1.15) {
        ins.push({ t:'blue', i:'📅',
          h:\`\${DOW_NAMES[best.d]} — лучший день (\${fmtR(best.avg)})\`,
          b:\`Разрыв с \${DOW_NAMES[worst.d]} (\${fmtR(worst.avg)}) — ×\${(best.avg/worst.avg).toFixed(1)}. За \${daysN} дней.\`,
          a:null });
      }
    }
  }

  // Рендер: фильтруем null карточки, сортируем (red → amber → green → blue), берём до 6
  const validIns = ins.filter(x => x);
  const order = { red:0, amber:1, green:2, blue:3 };
  validIns.sort((a,b) => (order[a.t]||9) - (order[b.t]||9));
  box.innerHTML = validIns.slice(0,6).map(i =>
    \`<div class="ins-card \${i.t}"><div class="ins-t">\${i.i} \${i.h}</div><div class="ins-b">\${i.b}</div>\${i.a?\`<div class="ins-a">💡 \${i.a}</div>\`:''}</div>\`
  ).join('');
}

// ═══ DYNAMICS ═══
function setDynRest(idx){
  S.dynRestIdx=+idx;
  renderDynamics();
}
function getDynR(){
  // Returns the restaurant for Dynamics tab (local, doesn't affect other tabs)
  if(S.dynRestIdx>=0&&RESTS[S.dynRestIdx]) return RESTS[S.dynRestIdx];
  return R||RESTS[0]||null;
}
function buildDynRestSel(){
  const sel=document.getElementById('dynRestSel');
  if(!sel||!RESTS.length) return;
  sel.innerHTML=RESTS.map((r,i)=>\`<option value="\${i}">\${r.city}</option>\`).join('');
  // Default to current global restaurant
  const curIdx=R?RESTS.findIndex(r=>r.name===R.name):0;
  sel.value=curIdx>=0?curIdx:0;
  S.dynRestIdx=+sel.value;
}
function setDynQ(n,btn){S.dynPeriod=n;document.querySelectorAll('#p-dynamics .pgroup .pbtn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');const lbl=document.getElementById('dynRangeLbl');if(lbl)lbl.textContent=n===365?'год':n===90?'квартал':n===30?'месяц':n+'д';renderDynamics()}
function setRevM(m,btn){S.revMetric=m;document.querySelectorAll('#revMBtns .mtbtn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');renderRevChart()}
function setDOWMet(m,btn){S.dowMetric=m;document.querySelectorAll('#dowMetBtns .mtbtn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');renderDOW()}
function setDowFilter(f,btn){S.dowFilter=f;document.querySelectorAll('#dowFilterBtns .pbtn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');renderDowFilter()}

function getDynTs(){
  const ts=getTsRange(getDynR(),S.dynStart,S.dynEnd);
  return ts.slice(-S.dynPeriod);
}

function renderDynamics(){
  renderRevChart();
  renderLineChart2('chkC','avgCheck','#4A9EF5','Средний чек',false,null,v=>fmtR(v));
  renderLineChart2('cntC','checks','#9B59B6','Чеков/день',true,NET.checks,null);
  renderLineChart2('fcC','foodcost','#F39C12','Фудкост %',true,NET.foodcost,null);
  renderLineChart2('discC','discount','#E74C3C','Скидки %',true,NET.discount,null);
  renderDOW();
  renderDowFilter();
  renderDynStats();
}
function renderRevChart(){
  const ts=getDynTs();
  const mc={revenue:'#D4A84B',kitchen:'#4A9EF5',bar:'#9B59B6',delivery:'#2ECC71'};
  const ml={revenue:'Общая',kitchen:'Кухня',bar:'Бар',delivery:'Доставка'};
  mkChart('revC',{type:'bar',data:{labels:ts.map(t=>t.date.slice(5)),datasets:[{label:ml[S.revMetric],data:ts.map(t=>t[S.revMetric]||0),backgroundColor:mc[S.revMetric]+'99',borderColor:mc[S.revMetric],borderWidth:1,borderRadius:4},{label:'Сеть',data:ts.map(()=>NET.revenue),type:'line',borderColor:'rgba(142,170,206,.4)',borderDash:[4,4],borderWidth:1.5,pointRadius:0,fill:false}]},options:chartOpts(v=>fmtR(v))});
}
function renderLineChart2(id,key,color,label,showNet,netVal,yCb){
  const ts=getDynTs().filter(t=>t[key]!==null&&t[key]!==undefined);
  const ds=[{label,data:ts.map(t=>t[key]||0),borderColor:color,backgroundColor:color+'22',borderWidth:2,pointRadius:3,pointBackgroundColor:color,fill:true,tension:.3}];
  if(showNet&&netVal!==null) ds.push({label:'Сеть',data:ts.map(()=>netVal),borderColor:'rgba(142,170,206,.4)',borderDash:[4,4],borderWidth:1.5,pointRadius:0,fill:false});
  mkChart(id,{type:'line',data:{labels:ts.map(t=>t.date.slice(5)),datasets:ds},options:chartOpts(yCb||null)});
}

function renderDOW(){
  const ts=getDynTs();
  const byDow={};
  ts.forEach(t=>{const d=getDOW(t.date);if(!byDow[d])byDow[d]=[];byDow[d].push({v:t[S.dowMetric]||0,date:t.date})});
  const order=[1,2,3,4,5,6,0]; // Mon..Sun
  const avgs=order.map(d=>({d,avg:byDow[d]?avgArr(byDow[d].map(x=>x.v)):null,count:byDow[d]?.length||0}));
  const validAvgs=avgs.filter(a=>a.avg!==null);
  const maxAvg=Math.max(...validAvgs.map(a=>a.avg));
  const minAvg=Math.min(...validAvgs.map(a=>a.avg));

  document.getElementById('dowCards').innerHTML=avgs.map(a=>{
    const isWE=a.d===0||a.d===6;
    const isBest=a.avg===maxAvg&&a.avg!==null;
    const isWorst=a.avg===minAvg&&a.avg!==null&&validAvgs.length>1;
    let cls='dow-card';
    if(isWE) cls+=' weekend';
    if(isBest) cls+=' best';
    else if(isWorst) cls+=' worst';
    const val=a.avg!==null?(S.dowMetric==='revenue'||S.dowMetric==='avgCheck'?fmtR(a.avg):fmtN(a.avg,1)):'-';
    return \`<div class="\${cls}"><div class="dow-name">\${DOW_NAMES[a.d]}</div><div class="dow-rev" style="font-size:16px">\${val}</div><div class="dow-chk">\${a.count} дней</div><div class="dow-badge \${isWE?'badge-we':'badge-wd'}">\${isWE?'выходной':'будни'}</div></div>\`;
  }).join('');

  // DOW bar chart
  mkChart('dowC',{type:'bar',data:{labels:avgs.map(a=>DOW_NAMES[a.d]),datasets:[{label:S.dowMetric,data:avgs.map(a=>a.avg||0),backgroundColor:avgs.map(a=>(a.d===0||a.d===6)?'rgba(212,168,75,.7)':'rgba(74,158,245,.7)'),borderColor:avgs.map(a=>(a.d===0||a.d===6)?'#D4A84B':'#4A9EF5'),borderWidth:1,borderRadius:5}]},options:{...chartOpts(S.dowMetric==='revenue'||S.dowMetric==='avgCheck'?v=>fmtR(v):null)}});
}

function renderDowFilter(){
  const ts=getDynTs();
  const f=S.dowFilter;
  const DOW_MAP={all:null,weekday:[1,2,3,4,5],weekend:[0,6],mon:[1],tue:[2],wed:[3],thu:[4],fri:[5],sat:[6],sun:[0]};
  const allowed=DOW_MAP[f];
  const filtered=allowed?ts.filter(t=>allowed.includes(getDOW(t.date))):ts;
  if(!filtered.length){document.getElementById('dowStats').textContent='Нет данных для выбранного фильтра';return;}

  const avgR=avgArr(filtered.map(t=>t.revenue));
  const avgC=avgArr(filtered.map(t=>t.avgCheck));
  const avgCnt=avgArr(filtered.map(t=>t.checks));
  document.getElementById('dowStats').innerHTML=\`<span style="color:var(--text2)">Среднее за выбранный фильтр:</span> выручка <b style="color:var(--gold)">\${fmtR(avgR)}</b> · чек <b style="color:var(--gold)">\${fmtR(avgC)}</b> · чеков <b style="color:var(--gold)">\${Math.round(avgCnt)}</b> · дней: \${filtered.length}\`;

  mkChart('dowFilterC',{type:'line',data:{labels:filtered.map(t=>t.date.slice(5)+' ('+DOW_NAMES[getDOW(t.date)]+')'),datasets:[{label:'Выручка',data:filtered.map(t=>t.revenue),borderColor:'#D4A84B',backgroundColor:'rgba(212,168,75,.1)',borderWidth:2,pointRadius:4,fill:true,tension:.2}]},options:{...chartOpts(v=>fmtR(v)),plugins:{legend:{display:false}}}});
}

function renderDynStats(){
  const ts=getDynTs();
  const metrics=[{k:'revenue',l:'Выручка',f:fmtR},{k:'avgCheck',l:'Ср. чек',f:fmtR},{k:'checks',l:'Чеков',f:v=>Math.round(v)},{k:'foodcost',l:'Фудкост %',f:v=>v!==null?fmtN(v)+'%':'—'},{k:'discount',l:'Скидки %',f:v=>fmtN(v)+'%'}];
  document.getElementById('dynStatB').innerHTML=metrics.map(m=>{
    const vals=ts.map(t=>t[m.k]).filter(v=>v!==null&&v!==undefined&&v>0);
    if(!vals.length) return '';
    const mn=Math.min(...vals),mx=Math.max(...vals),avg=avgArr(vals),last=vals[vals.length-1],prev2=vals.length>=2?vals[vals.length-2]:null;
    const trend=prev2!==null?(last>prev2?'<span class="up">▲</span>':last<prev2?'<span class="dn">▼</span>':'<span class="nt">→</span>'):'';
    return \`<tr><td class="c-m">\${m.l}</td><td>\${m.f(mn)}</td><td>\${m.f(mx)}</td><td>\${m.f(avg)}</td><td class="c-s">\${m.f(last)}</td><td>\${trend}</td></tr>\`;
  }).join('');
}

// ═══ COMPARE ═══
function buildCompSlots(){
  const area=document.getElementById('compSlots');
  const lblColors=['var(--gold)','var(--teal)','var(--purple)','var(--amber)','var(--red)'];
  area.innerHTML=Array.from({length:N_COMP},(_,i)=>\`
    <div class="comp-slot">
      <div class="comp-lbl" style="color:\${lblColors[i]}">Точка \${i+1}</div>
      <select class="comp-sel" id="cs\${i}" onchange="renderCompare()">
        \${i===0?'':'<option value="">— не выбрана —</option>'}
        \${RESTS.map((r,j)=>\`<option value="\${j}" \${i===0&&j===0?'selected':''}>\${r.city}</option>\`).join('')}
      </select>
    </div>\`).join('');
}
function getCompRests(){
  return Array.from({length:N_COMP},(_,i)=>{
    const el=document.getElementById('cs'+i);
    if(!el||el.value==='') return null;
    return RESTS[parseInt(el.value)];
  }).filter(Boolean);
}
function getCmpTs(r){return getTsRange(r,S.cmpStart,S.cmpEnd)}
function getCompMetVal(r2,m){
  const ts=getCmpTs(r2);
  if(!ts.length) return 0;
  if(m==='delivPct'){const r=safeAvg(ts,'revenue')||1,d=safeAvg(ts,'delivery')||0;return d/r*100;}
  return safeAvg(ts,m)||0;
}

function setCmpM(m,btn){S.compMetric=m;document.querySelectorAll('#compMBtns .mtbtn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');renderCompare()}
function renderCompare(){
  const comps=getCompRests();
  if(!comps.length) return;
  const isRub=['revenue','avgCheck'].includes(S.compMetric);
  const netVals={revenue:NET.revenue,avgCheck:NET.avgCheck,checks:NET.checks,foodcost:NET.foodcost,discount:NET.discount,delivPct:NET.deliveryPct};

  mkChart('cmpBarC',{type:'bar',data:{
    labels:comps.map(r2=>r2.city),
    datasets:[
      ...comps.map((r2,i)=>({label:r2.city,data:[getCompMetVal(r2,S.compMetric)],backgroundColor:COMP_COLORS[i]+'99',borderColor:COMP_COLORS[i],borderWidth:1,borderRadius:4})),
      {label:'Сеть',data:comps.map(()=>netVals[S.compMetric]),type:'line',borderColor:'rgba(142,170,206,.4)',borderDash:[4,4],borderWidth:1.5,pointRadius:0,fill:false}
    ]
  },options:chartOpts(v=>isRub?fmtR(v):v)});

  const baseDates=getCmpTs(comps[0]).map(t=>t.date.slice(5));
  mkChart('cmpTrC',{type:'line',data:{labels:baseDates,datasets:comps.map((r2,i)=>({label:r2.city,data:getCmpTs(r2).map(t=>t.revenue),borderColor:COMP_COLORS[i],backgroundColor:COMP_COLORS[i]+'15',borderWidth:i===0?2.5:1.5,pointRadius:i===0?3:2,fill:false,tension:.3}))},options:chartOpts(v=>fmtR(v))});

  const metrics=[{k:'revenue',l:'Выручка',f:fmtR},{k:'avgCheck',l:'Ср. чек',f:fmtR},{k:'checks',l:'Чеков/день',f:v=>Math.round(v)},{k:'foodcost',l:'Фудкост %',f:v=>v!==null?fmtN(v)+'%':'—'},{k:'discount',l:'Скидки %',f:v=>fmtN(v)+'%'},{k:'delivPct',l:'Доставка %',f:v=>fmtN(v,1)+'%'}];
  document.getElementById('cmpTH').innerHTML=\`<tr><th>Метрика</th>\${comps.map((r2,i)=>\`<th style="color:\${COMP_COLORS[i]}">\${r2.city}</th>\`).join('')}</tr>\`;
  document.getElementById('cmpTB').innerHTML=metrics.map(m=>\`<tr><td class="c-m">\${m.l}</td>\${comps.map((r2,i)=>\`<td style="color:\${COMP_COLORS[i]};font-weight:\${i===0?600:400}">\${m.f(getCompMetVal(r2,m.k))}</td>\`).join('')}</tr>\`).join('');

  const r=comps[0],dp=r.revenue>0?r.delivery/r.revenue*100:0;
  const rows=[{l:'Выручка/день',s:r.revenue,n:NET.revenue,t:TOP10.revenue,f:fmtR,lb:false},{l:'Ср. чек',s:r.avgCheck,n:NET.avgCheck,t:TOP10.avgCheck,f:fmtR,lb:false},{l:'Чеков/день',s:r.checks,n:NET.checks,t:null,f:v=>Math.round(v),lb:false},{l:'Фудкост %',s:r.foodcost,n:NET.foodcost,t:TOP10.foodcost,f:v=>v!==null?fmtN(v)+'%':'—',lb:true},{l:'Скидки %',s:r.discount,n:NET.discount,t:TOP10.discount,f:v=>fmtN(v,1)+'%',lb:true},{l:'Доставка %',s:dp,n:NET.deliveryPct,t:TOP10.deliveryPct,f:v=>fmtN(v,1)+'%',lb:false}];
  // Update "ваша точка" header with city name
  const ownHdr=document.getElementById('netTH_own');
  if(ownHdr) ownHdr.textContent=comps[0]?comps[0].city:'Точка 1';
  document.getElementById('netTB').innerHTML=rows.map(row=>{
    if(row.s===null) return '';
    const vn=pctD(row.s,row.n),vt=row.t!==null?pctD(row.s,row.t):null;
    const on=row.lb?vn<0:vn>0,ot=vt!==null?(row.lb?vt<0:vt>0):null;
    return \`<tr><td class="c-m">\${row.l}</td><td class="c-s">\${row.f(row.s)}</td><td class="c-n">\${row.f(row.n)}</td><td class="c-t">\${row.t!==null?row.f(row.t):'—'}</td><td class="\${on?'tag-u':'tag-d'}">\${on?'▲':'▼'} \${Math.abs(vn).toFixed(1)}%</td><td>\${vt!==null?\`<span class="\${ot?'tag-u':'tag-d'}">\${ot?'▲':'▼'} \${Math.abs(vt).toFixed(1)}%</span>\`:'—'}</td></tr>\`;
  }).join('');
}

// ═══ ANALYSIS ═══
function renderAnalysis(){
  renderWDB();
  const ts=getGlobalTs();
  const fc=safeAvg(ts,'foodcost')||NET.foodcost||23;
  const chk=safeAvg(ts,'avgCheck')||R.avgCheck||1400;
  const cnt=safeAvg(ts,'checks')||R.checks||80;
  const disc=safeAvg(ts,'discount')||R.discount||7;
  const rev=safeAvg(ts,'revenue')||R.revenue||0;
  const net_rev=rev*(1-disc/100);
  S.plChk=chk;S.plCnt=cnt;S.plFc=fc;S.plDisc=disc;
  document.getElementById('sl-chk').value=Math.round(chk);
  document.getElementById('sl-cnt').value=Math.round(cnt);
  document.getElementById('sl-fc').value=fc;
  document.getElementById('sl-disc').value=disc;
  calcPL();
}
function resetPL(){renderAnalysis()}
function setWDayPL(){
  const ts=getGlobalTs().filter(t=>!isWeekend(t.date));
  if(!ts.length) return;
  document.getElementById('sl-chk').value=Math.round(safeAvg(ts,'avgCheck'));
  document.getElementById('sl-cnt').value=Math.round(safeAvg(ts,'checks'));
  if(safeAvg(ts,'foodcost')) document.getElementById('sl-fc').value=safeAvg(ts,'foodcost');
  document.getElementById('sl-disc').value=safeAvg(ts,'discount')||0;
  calcPL();
}
function setWEndPL(){
  const ts=getGlobalTs().filter(t=>isWeekend(t.date));
  if(!ts.length) return;
  document.getElementById('sl-chk').value=Math.round(safeAvg(ts,'avgCheck'));
  document.getElementById('sl-cnt').value=Math.round(safeAvg(ts,'checks'));
  if(safeAvg(ts,'foodcost')) document.getElementById('sl-fc').value=safeAvg(ts,'foodcost');
  document.getElementById('sl-disc').value=safeAvg(ts,'discount')||0;
  calcPL();
}

function renderWDB(){
  const ts=getGlobalTs();
  const wdTs=ts.filter(t=>!isWeekend(t.date));
  const weTs=ts.filter(t=>isWeekend(t.date));
  const wdR=safeAvg(wdTs,'revenue')||0,weR=safeAvg(weTs,'revenue')||0;
  const wdC=safeAvg(wdTs,'avgCheck')||0,weC=safeAvg(weTs,'avgCheck')||0;
  const wdCnt=safeAvg(wdTs,'checks')||0,weCnt=safeAvg(weTs,'checks')||0;
  const wdFc=safeAvg(wdTs,'foodcost'),weFc=safeAvg(weTs,'foodcost');
  const wdDisc=safeAvg(wdTs,'discount')||0,weDisc=safeAvg(weTs,'discount')||0;

  document.getElementById('wdbGrid').innerHTML=\`
    <div class="wdb-box wd">
      <div class="wdb-t" style="color:var(--blue)">📅 Будни (Пн–Пт) · \${wdTs.length} дней</div>
      <div class="wdb-rev" style="color:var(--blue)">\${fmtR(wdR)}</div>
      <div style="font-size:9px;color:var(--text3);margin-bottom:8px">средняя выручка/день</div>
      <div class="wdb-row"><span>Средний чек</span><span style="color:var(--text)">\${fmtR(wdC)}</span></div>
      <div class="wdb-row"><span>Чеков/день</span><span style="color:var(--text)">\${Math.round(wdCnt)}</span></div>
      <div class="wdb-row"><span>Фудкост</span><span style="color:var(--text)">\${wdFc!==null?fmtN(wdFc)+'%':'—'}</span></div>
      <div class="wdb-row"><span>Скидки</span><span style="color:var(--text)">\${fmtN(wdDisc,1)}%</span></div>
    </div>
    <div class="wdb-box we">
      <div class="wdb-t" style="color:var(--gold)">🎉 Выходные (Сб–Вс) · \${weTs.length} дней</div>
      <div class="wdb-rev" style="color:var(--gold)">\${fmtR(weR)}</div>
      <div style="font-size:9px;color:var(--text3);margin-bottom:8px">средняя выручка/день</div>
      <div class="wdb-row"><span>Средний чек</span><span style="color:var(--text)">\${fmtR(weC)}</span></div>
      <div class="wdb-row"><span>Чеков/день</span><span style="color:var(--text)">\${Math.round(weCnt)}</span></div>
      <div class="wdb-row"><span>Фудкост</span><span style="color:var(--text)">\${weFc!==null?fmtN(weFc)+'%':'—'}</span></div>
      <div class="wdb-row"><span>Скидки</span><span style="color:var(--text)">\${fmtN(weDisc,1)}%</span></div>
    </div>\`;

  // Chart showing WD vs WE by day
  // Chart showing revenue by day with weekday/weekend color coding
  mkChart('wdC',{type:'bar',data:{
    labels:ts.map(t=>t.date.slice(5)+' '+DOW_NAMES[getDOW(t.date)]),
    datasets:[
      {label:'Выручка',data:ts.map(t=>t.revenue),backgroundColor:ts.map(t=>isWeekend(t.date)?'rgba(212,168,75,.7)':'rgba(74,158,245,.7)'),borderColor:ts.map(t=>isWeekend(t.date)?'#D4A84B':'#4A9EF5'),borderWidth:1,borderRadius:3},
      {label:'Будни (среднее)',data:ts.map(()=>wdR),type:'line',borderColor:'rgba(74,158,245,.5)',borderDash:[4,4],borderWidth:1.5,pointRadius:0,fill:false},
      {label:'Выходные (среднее)',data:ts.map(()=>weR),type:'line',borderColor:'rgba(212,168,75,.5)',borderDash:[4,4],borderWidth:1.5,pointRadius:0,fill:false}
    ]
  },options:chartOpts(v=>fmtR(v))});

  // WDB insights
  const ins=[];
  if(weR>0&&wdR>0){
    const ratio=(weR/wdR).toFixed(1);
    if(weR/wdR>1.8) ins.push({t:'blue',txt:\`Выходные приносят в <b>\${ratio}×</b> больше чем будни. Оптимизируйте загрузку будних смен — это \${fmtR((weR-wdR)*10)}/месяц недополученной выручки.\`});
    if(Math.abs(wdC-weC)/weC>0.1) ins.push({t:'amber',txt:\`Средний чек в будни <b>\${fmtR(wdC)}</b> vs выходные <b>\${fmtR(weC)}</b>. Разрыв \${fmtN(Math.abs(pctD(wdC,weC)),0)}%. Введите будничные combo-предложения.\`});
    if(wdFc!==null&&weFc!==null&&wdFc>weFc+1) ins.push({t:'amber',txt:\`Фудкост в будни <b>\${fmtN(wdFc)}%</b> выше чем в выходные <b>\${fmtN(weFc)}%</b>. Причина: меньше трафика при тех же нормах закупок. Оптимизируйте заготовки.\`});
  }
  document.getElementById('wdbInsights').innerHTML=ins.map(i=>\`<div class="ins-card \${i.t}" style="margin:0"><div class="ins-b" style="font-size:11px">\${i.txt}</div></div>\`).join('');
}

function plCalc(chk,cnt,fc,disc){
  const rev=chk*cnt;
  const discAmt=rev*disc/100;
  const net=rev-discAmt;
  const fcAmt=net*fc/100;
  const fot=net*0.25;
  const rent=net*0.15;
  const profit=net-fcAmt-fot-rent;
  return{rev,discAmt,net,fcAmt,fot,rent,profit};
}
function plHtml(p,color){
  const pColor=p.profit>=0?'var(--green)':'var(--red)';
  return \`<div class="pl-r"><span class="pl-lbl">Выручка/день</span><span class="pl-amt">\${fmtR(p.rev)}</span></div>
    <div class="pl-r"><span class="pl-lbl">− Скидки</span><span class="pl-amt" style="color:var(--red)">−\${fmtR(p.discAmt)}</span></div>
    <div class="pl-r"><span class="pl-lbl">Нетто</span><span class="pl-amt">\${fmtR(p.net)}</span></div>
    <div class="pl-r"><span class="pl-lbl">− Фудкост</span><span class="pl-amt" style="color:var(--amber)">−\${fmtR(p.fcAmt)}</span></div>
    <div class="pl-r"><span class="pl-lbl">− ФОТ 25%</span><span class="pl-amt" style="color:var(--text2)">−\${fmtR(p.fot)}</span></div>
    <div class="pl-r"><span class="pl-lbl">− Аренда 15%</span><span class="pl-amt" style="color:var(--text2)">−\${fmtR(p.rent)}</span></div>
    <div class="pl-tot"><span class="pl-tot-lbl">Прибыль/день</span><span class="pl-tot-amt" style="color:\${pColor}">\${fmtR(p.profit)}</span></div>
    <div style="font-size:10px;color:var(--text3);text-align:right">×26 дней: <span style="color:\${pColor};font-family:'Cormorant Garamond',serif;font-size:14px">\${fmtR(p.profit*26)}</span></div>\`;
}

function calcPL(){
  const slChk=document.getElementById('sl-chk');
  if(!slChk) return; // Analysis tab not rendered yet
  const chk=+slChk.value;
  const cnt=+document.getElementById('sl-cnt').value;
  const fc=+document.getElementById('sl-fc').value;
  const disc=+document.getElementById('sl-disc').value;
  document.getElementById('sl-chk-v').textContent=fmtR(chk);
  document.getElementById('sl-cnt-v').textContent=cnt;
  document.getElementById('sl-fc-v').textContent=fmtN(fc,1);
  document.getElementById('sl-disc-v').textContent=fmtN(disc,1);

  const current=plCalc(S.plChk,S.plCnt,S.plFc,S.plDisc);
  const adjusted=plCalc(chk,cnt,fc,disc);
  document.getElementById('plCurrent').innerHTML=plHtml(current,'var(--blue)');
  document.getElementById('plAdjusted').innerHTML=plHtml(adjusted,'var(--gold)');

  // Forecast boxes
  const profDelta=adjusted.profit-current.profit;
  const profDeltaColor=profDelta>=0?'var(--green)':'var(--red)';
  document.getElementById('fcBoxes').innerHTML=\`
    <div class="fc-box current">
      <div class="fc-box-title" style="color:var(--blue)">📊 При текущих показателях</div>
      <div class="fc-big" style="color:var(--blue)">\${fmtR(current.profit*26)}</div>
      <div class="fc-sub">прибыль/месяц</div>
      <div class="fc-metric" style="margin-top:8px"><span style="color:var(--text2)">Выручка/мес</span><span>\${fmtR(current.rev*26)}</span></div>
      <div class="fc-metric"><span style="color:var(--text2)">Выручка/год</span><span>\${fmtR(current.rev*26*12)}</span></div>
    </div>
    <div class="fc-box adjusted">
      <div class="fc-box-title" style="color:var(--gold)">🎯 Ваш сценарий</div>
      <div class="fc-big" style="color:var(--gold)">\${fmtR(adjusted.profit*26)}</div>
      <div class="fc-sub">прибыль/месяц</div>
      <div class="fc-metric" style="margin-top:8px"><span style="color:var(--text2)">Выручка/мес</span><span>\${fmtR(adjusted.rev*26)}</span></div>
      <div class="fc-metric"><span style="color:var(--text2)">Прибыль/год</span><span style="color:var(--gold)">\${fmtR(adjusted.profit*26*12)}</span></div>
      <div class="fc-metric"><span style="color:var(--text2)">Эффект за год</span><span style="color:\${profDeltaColor}">\${profDelta>=0?'+':''}\${fmtR(profDelta*26*12)}/год</span></div>
    </div>\`;

  // 30-day forecast chart
  const days=Array.from({length:30},(_,i)=>i+1);
  mkChart('fcC30',{type:'line',data:{labels:days.map(d=>d+'д'),datasets:[
    {label:'Текущий сценарий',data:days.map(d=>current.profit*d),borderColor:'#4A9EF5',backgroundColor:'rgba(74,158,245,.08)',borderWidth:2,pointRadius:0,fill:true,tension:.3},
    {label:'Ваш сценарий',data:days.map(d=>adjusted.profit*d),borderColor:'#D4A84B',backgroundColor:'rgba(212,168,75,.08)',borderWidth:2,pointRadius:0,fill:true,tension:.3},
    {label:'Ноль',data:days.map(()=>0),borderColor:'rgba(142,170,206,.2)',borderWidth:1,pointRadius:0,fill:false,borderDash:[2,4]}
  ]},options:chartOpts(v=>fmtR(v))});

  // Delta cards
  document.getElementById('fcDelta').innerHTML=[
    {l:'Прибыль/месяц — факт',v:current.profit*26,f:v=>fmtR(v)},
    {l:'Прибыль/месяц — сценарий',v:adjusted.profit*26,f:v=>fmtR(v)},
    {l:'Прибыль/год — сценарий',v:adjusted.profit*26*12,f:v=>fmtR(v)},
    {l:'Эффект за год vs факт',v:(adjusted.profit-current.profit)*26*12,f:v=>fmtR(v)},
  ].map(item=>{
    const c=item.v>0?'var(--green)':item.v<0?'var(--red)':'var(--text2)';
    return \`<div style="background:var(--card2);border:1px solid var(--border);border-radius:8px;padding:10px;text-align:center"><div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">\${item.l}</div><div style="font-family:'Cormorant Garamond',serif;font-size:20px;font-weight:700;color:\${c}">\${item.v>=0?'+':''}\${item.f(item.v)}</div></div>\`;
  }).join('');

  // Breakeven — guard against div/0
  const marginal = chk * (1 - disc/100) * (1 - fc/100);
  const fixedPerCheck = marginal > 0 ? (adjusted.fot + adjusted.rent) / cnt : 0;
  const beRev = adjusted.net > 0 ? adjusted.rev * (adjusted.fot + adjusted.rent) / adjusted.net : 0;
  const beChecks = marginal > 0 ? Math.ceil((adjusted.fot + adjusted.rent) / marginal) : '∞';
  document.getElementById('breakevenBox').innerHTML=\`
    <div style="margin-bottom:6px;color:var(--text2);font-size:10px">При текущих параметрах сценария:</div>
    <div style="font-family:'Cormorant Garamond',serif;font-size:26px;color:var(--gold)">\${fmtR(beRev)}/день</div>
    <div style="font-size:10px;color:var(--text2);margin-top:3px">\${beChecks} чеков по \${fmtR(chk)}</div>
    <div style="margin-top:10px;display:flex;flex-direction:column;gap:4px;font-size:11px">
      <div style="display:flex;justify-content:space-between"><span style="color:var(--text2)">Запас прочности</span><span style="color:\${adjusted.profit>=0?'var(--green)':'var(--red)'};font-weight:600">\${fmtR(adjusted.profit)}/день</span></div>
      <div style="display:flex;justify-content:space-between"><span style="color:var(--text2)">Покрытие ФОТ</span><span>\${(adjusted.net*(1-fc/100)>adjusted.fot?'✅ Да':'⚠️ Нет')}</span></div>
    </div>\`;

  document.getElementById('scenBox').innerHTML=[
    {l:'+10% чеков в день',delta:(plCalc(chk,cnt*1.1,fc,disc).profit-adjusted.profit)},
    {l:'−1% фудкост',delta:(plCalc(chk,cnt,fc-1,disc).profit-adjusted.profit)},
    {l:'−1% скидок',delta:(plCalc(chk,cnt,fc,disc-1).profit-adjusted.profit)},
    {l:'+100₽ к чеку',delta:(plCalc(chk+100,cnt,fc,disc).profit-adjusted.profit)},
    {l:'Будни = уровню выходных',delta:adjusted.profit*0.3},
  ].map(s=>\`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(46,64,104,.4);font-size:11px"><span style="color:var(--text2)">\${s.l}</span><span style="color:var(--green);font-weight:600">+\${fmtR(s.delta)}/д = +\${fmtR(s.delta*26)}/мес</span></div>\`).join('');

  // P&L stacked bar
  mkChart('plBarC',{type:'bar',data:{labels:['Факт','Сценарий'],datasets:[
    {label:'Скидки',data:[current.discAmt,adjusted.discAmt],backgroundColor:'#E74C3C88',borderColor:'#E74C3C',borderWidth:1,borderRadius:2},
    {label:'Фудкост',data:[current.fcAmt,adjusted.fcAmt],backgroundColor:'#F39C1288',borderColor:'#F39C12',borderWidth:1},
    {label:'ФОТ',data:[current.fot,adjusted.fot],backgroundColor:'#4A9EF588',borderColor:'#4A9EF5',borderWidth:1},
    {label:'Аренда',data:[current.rent,adjusted.rent],backgroundColor:'#9B59B688',borderColor:'#9B59B6',borderWidth:1},
    {label:'Прибыль',data:[Math.max(0,current.profit),Math.max(0,adjusted.profit)],backgroundColor:'#2ECC7188',borderColor:'#2ECC71',borderWidth:1},
  ]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#8AAACE',font:{size:9},boxWidth:10}}},scales:{x:{stacked:true,grid:{color:'rgba(46,64,104,.4)'},ticks:{color:'#4E6A90',font:{size:9},callback:v=>fmtR(v)}},y:{stacked:true,grid:{color:'rgba(46,64,104,.4)'},ticks:{color:'#4E6A90',font:{size:9}}}}}});
}

// ═══ FEEDBACK WIDGET ═══
function fbGetEmail(){
  try{const jwt=getJWT();if(!jwt)return'';const p=JSON.parse(atob(jwt.split('.')[1]));return p.email||'';}catch{return'';}
}
let fbCat='';
function fbOpen(){
  document.getElementById('fbOverlay').classList.add('open');
  document.getElementById('fbText').value='';
  document.getElementById('fbOk').style.display='none';
  document.getElementById('fbSend').disabled=false;
  fbCat='';
  document.querySelectorAll('.fb-cat').forEach(b=>b.classList.remove('sel'));
  const rest=R?R.name:'—';
  document.getElementById('fbMeta').textContent='Ресторан: '+rest+' · '+fbGetEmail();
}
function fbClose(){document.getElementById('fbOverlay').classList.remove('open');}
function fbPickCat(el,cat){
  fbCat=cat;
  document.querySelectorAll('.fb-cat').forEach(b=>b.classList.remove('sel'));
  el.classList.add('sel');
}
async function fbSend(){
  const text=document.getElementById('fbText').value.trim();
  if(!fbCat||!text){alert('Выберите категорию и напишите текст');return;}
  const btn=document.getElementById('fbSend');
  btn.disabled=true;btn.textContent='Отправка…';
  try{
    const jwt=getJWT();
    const r=await fetch(API_BASE+'/api/feedback',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+jwt},
      body:JSON.stringify({category:fbCat,text:text,restaurant:R?R.name:'—'})
    });
    if(!r.ok) throw new Error('HTTP '+r.status);
    document.getElementById('fbOk').style.display='block';
    document.getElementById('fbOk').textContent='✓ Спасибо! Обратная связь отправлена.';
    setTimeout(fbClose,1800);
  }catch(e){
    alert('Ошибка отправки: '+e.message);
    btn.disabled=false;btn.textContent='Отправить';
  }
}

init();
</script>

<!-- Footer -->
<div style="text-align:center;padding:24px 20px 80px;font-size:10px;color:var(--text3);letter-spacing:0.5px">
  © 2026 System360 by Alex Melnikov. All rights reserved.
</div>

<!-- Feedback widget -->
<button class="fb-float" onclick="fbOpen()" title="Обратная связь">💬</button>
<div class="fb-overlay" id="fbOverlay" onclick="if(event.target===this)fbClose()">
  <div class="fb-modal">
    <div class="fb-title">Обратная связь</div>
    <div class="fb-cats">
      <button class="fb-cat" onclick="fbPickCat(this,'Баг')">🐛 Баг</button>
      <button class="fb-cat" onclick="fbPickCat(this,'Идея')">💡 Идея</button>
      <button class="fb-cat" onclick="fbPickCat(this,'Данные неверны')">📊 Данные неверны</button>
      <button class="fb-cat" onclick="fbPickCat(this,'Непонятно')">❓ Непонятно</button>
    </div>
    <textarea class="fb-text" id="fbText" placeholder="Опишите подробно…"></textarea>
    <div class="fb-meta" id="fbMeta"></div>
    <div class="fb-actions">
      <button class="fb-cancel" onclick="fbClose()">Отмена</button>
      <button class="fb-send" id="fbSend" onclick="fbSend()">Отправить</button>
    </div>
    <div class="fb-ok" id="fbOk"></div>
  </div>
</div>
</body>
</html>
`;
