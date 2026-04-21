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
.comp-area{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:16px}
.comp-slot{min-width:0}
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
        <div class="kcard" title="Средняя дневная выручка за выбранный период. Сравнивается с медианой за те же дни недели за 90 дней (ваша норма)."><div class="klbl">Выручка / день</div><div class="kval" id="kv-rev">—</div><div class="kdelta" id="kd-rev"></div><div class="kbench" id="kb-rev"></div><div class="kbar bgo" id="kr-rev" style="width:0"></div></div>
        <div class="kcard" title="Средняя сумма одного чека. Зависит от меню и скидок — сам по себе высокий чек не всегда лучше."><div class="klbl">Средний чек</div><div class="kval" id="kv-chk">—</div><div class="kdelta" id="kd-chk"></div><div class="kbench" id="kb-chk"></div><div class="kbar bb" id="kr-chk" style="width:0"></div></div>
        <div class="kcard" title="Среднее количество чеков в день. Рост при стабильном среднем чеке = больше гостей."><div class="klbl">Чеков / день</div><div class="kval" id="kv-cnt">—</div><div class="kdelta" id="kd-cnt"></div><div class="kbench" id="kb-cnt"></div><div class="kbar bb" id="kr-cnt" style="width:0"></div></div>
      </div>
      <div class="g3">
        <div class="kcard" title="Себестоимость продуктов как % выручки (iiko). Целевой диапазон: 20-23%. Ниже = лучше маржа."><div class="klbl">Фудкост %</div><div class="kval" id="kv-fc">—</div><div class="kdelta" id="kd-fc"></div><div class="kbench" id="kb-fc"></div><div class="kbar" id="kr-fc" style="width:0"></div></div>
        <div class="kcard" title="Доля скидок и списаний в выручке. Высокие скидки снижают маржу — контролируй причины."><div class="klbl">Скидки %</div><div class="kval" id="kv-disc">—</div><div class="kdelta" id="kd-disc"></div><div class="kbench" id="kb-disc"></div><div class="kbar" id="kr-disc" style="width:0"></div></div>
        <div class="kcard" id="kcard-del" title="Доля выручки от доставки. Высокая доля = зависимость от агрегаторов (Яндекс.Еда и др.)."><div class="klbl">Доставка %</div><div class="kval" id="kv-del">—</div><div class="kdelta" id="kd-del"></div><div class="kbench" id="kb-del"></div><div class="kbar bg" id="kr-del" style="width:0"></div></div>
      </div>
      <div style="font-size:9px;color:var(--text3);margin-top:4px;text-align:right" title="Дни с техническими сбоями iiko (is_anomaly_day=1) автоматически исключаются из расчётов">ⓘ Дни с техсбоями исключены из расчётов</div>
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
    <div style="display:flex;align-items:center;gap:6px">
      <span style="font-size:11px;color:var(--text3)">Группировка:</span>
    </div>
    <div class="pgroup" id="dynGroupBtns">
      <button class="pbtn active" onclick="setDynGroup('day',this)">День</button>
      <button class="pbtn" onclick="setDynGroup('week',this)">7д</button>
      <button class="pbtn" onclick="setDynGroup('month',this)">Мес</button>
      <button class="pbtn" onclick="setDynGroup('quarter',this)">Квар</button>
      <button class="pbtn" onclick="setDynGroup('year',this)">Год</button>
    </div>
  </div>

  <div class="card" style="margin-bottom:12px">
    <div class="ctitle" id="revChartTitle">💰 Выручка по дням</div>
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
  <div class="prow" style="flex-wrap:wrap;gap:10px;margin-bottom:8px">
    <div style="display:flex;align-items:center;gap:6px">
      <span style="font-size:11px;color:var(--text3)">Группировка:</span>
    </div>
    <div class="pgroup" id="cmpGroupBtns">
      <button class="pbtn active" onclick="setCmpGroup('day',this)">День</button>
      <button class="pbtn" onclick="setCmpGroup('week',this)">7д</button>
      <button class="pbtn" onclick="setCmpGroup('month',this)">Мес</button>
      <button class="pbtn" onclick="setCmpGroup('quarter',this)">Квар</button>
      <button class="pbtn" onclick="setCmpGroup('year',this)">Год</button>
    </div>
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
    <div class="ctitle" id="cmpTrTitle">📈 Тренд выручки</div>
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

  <!-- P&L Calculator — #76 вариант B: два сценария (будни/выходные) -->
  <div class="card" style="margin-bottom:12px">
    <div class="ctitle">🧮 Калькулятор маржи «Что если»</div>
    <div style="background:rgba(142,170,206,.08);border-left:3px solid var(--blue);padding:10px 14px;margin-bottom:14px;border-radius:4px;font-size:11px;color:var(--text2);line-height:1.55">
      ℹ️ Здесь считается <b style="color:var(--text)">маржа до прочих расходов</b> на основе реальных данных из iiko. Калькулятор разделяет будни (Пн-Пт) и выходные (Сб-Вс) — итог месяца = (22 будних × маржа будни) + (8 выходных × маржа выходные). Полный P&amp;L с ФОТ, арендой и прибылью — в отдельной вкладке <b>(в разработке после 1С)</b>.
    </div>
    <div class="g2" style="gap:16px">
      <!-- Weekday scenario -->
      <div style="background:rgba(74,158,245,.04);border:1px solid rgba(74,158,245,.15);border-radius:8px;padding:14px">
        <div style="font-size:11px;color:var(--blue);text-transform:uppercase;letter-spacing:1px;font-weight:600;margin-bottom:10px">📅 Будни (Пн–Пт) · <span id="pl-wd-days">22 дня/мес</span></div>
        <div class="sl-row">
          <div class="sl-hdr"><span class="sl-name">Средний чек (₽)</span><span class="sl-val" id="sl-wd-chk-v">—</span></div>
          <input type="range" id="sl-wd-chk" min="300" max="3500" step="10" oninput="calcPL()">
        </div>
        <div class="sl-row">
          <div class="sl-hdr"><span class="sl-name">Чеков в день</span><span class="sl-val" id="sl-wd-cnt-v">—</span></div>
          <input type="range" id="sl-wd-cnt" min="5" max="400" step="1" oninput="calcPL()">
        </div>
        <div class="sl-row">
          <div class="sl-hdr"><span class="sl-name">Фудкост (%)</span><span><span class="sl-val" id="sl-wd-fc-v">—</span><span class="sl-unit">%</span></span></div>
          <input type="range" id="sl-wd-fc" min="12" max="40" step="0.1" oninput="calcPL()">
        </div>
        <div class="sl-row">
          <div class="sl-hdr"><span class="sl-name">Скидки (%)</span><span><span class="sl-val" id="sl-wd-disc-v">—</span><span class="sl-unit">%</span></span></div>
          <input type="range" id="sl-wd-disc" min="0" max="25" step="0.1" oninput="calcPL()">
        </div>
        <div style="border-top:1px solid rgba(74,158,245,.2);margin-top:10px;padding-top:8px;display:flex;justify-content:space-between;align-items:baseline">
          <span style="font-size:10px;color:var(--text2)">Маржа/будний день</span>
          <span id="pl-wd-margin" style="font-family:'Cormorant Garamond',serif;font-size:20px;font-weight:700;color:var(--blue)">—</span>
        </div>
      </div>
      <!-- Weekend scenario -->
      <div style="background:rgba(212,168,75,.04);border:1px solid rgba(212,168,75,.15);border-radius:8px;padding:14px">
        <div style="font-size:11px;color:var(--gold);text-transform:uppercase;letter-spacing:1px;font-weight:600;margin-bottom:10px">🎉 Выходные (Сб–Вс) · <span id="pl-we-days">8 дней/мес</span></div>
        <div class="sl-row">
          <div class="sl-hdr"><span class="sl-name">Средний чек (₽)</span><span class="sl-val" id="sl-we-chk-v">—</span></div>
          <input type="range" id="sl-we-chk" min="300" max="3500" step="10" oninput="calcPL()">
        </div>
        <div class="sl-row">
          <div class="sl-hdr"><span class="sl-name">Чеков в день</span><span class="sl-val" id="sl-we-cnt-v">—</span></div>
          <input type="range" id="sl-we-cnt" min="5" max="400" step="1" oninput="calcPL()">
        </div>
        <div class="sl-row">
          <div class="sl-hdr"><span class="sl-name">Фудкост (%)</span><span><span class="sl-val" id="sl-we-fc-v">—</span><span class="sl-unit">%</span></span></div>
          <input type="range" id="sl-we-fc" min="12" max="40" step="0.1" oninput="calcPL()">
        </div>
        <div class="sl-row">
          <div class="sl-hdr"><span class="sl-name">Скидки (%)</span><span><span class="sl-val" id="sl-we-disc-v">—</span><span class="sl-unit">%</span></span></div>
          <input type="range" id="sl-we-disc" min="0" max="25" step="0.1" oninput="calcPL()">
        </div>
        <div style="border-top:1px solid rgba(212,168,75,.2);margin-top:10px;padding-top:8px;display:flex;justify-content:space-between;align-items:baseline">
          <span style="font-size:10px;color:var(--text2)">Маржа/выходной день</span>
          <span id="pl-we-margin" style="font-family:'Cormorant Garamond',serif;font-size:20px;font-weight:700;color:var(--gold)">—</span>
        </div>
      </div>
    </div>
    <div style="margin-top:12px">
      <button onclick="resetPL()" style="padding:6px 14px;background:rgba(212,168,75,.12);border:1px solid rgba(212,168,75,.25);border-radius:6px;color:var(--gold);font-size:11px;cursor:pointer;font-family:Inter,sans-serif">↺ Сбросить к текущему факту</button>
    </div>
  </div>

  <!-- Month totals: factual vs scenario -->
  <div class="card" style="margin-bottom:12px">
    <div class="ctitle">📊 Итог месяца: факт vs сценарий</div>
    <div class="g2" style="gap:14px">
      <div style="background:rgba(74,158,245,.04);border:1px solid rgba(74,158,245,.2);border-radius:8px;padding:14px">
        <div style="font-size:11px;color:var(--blue);text-transform:uppercase;letter-spacing:1px;font-weight:600;margin-bottom:8px">📊 Текущий факт</div>
        <div id="plMonthFactual"></div>
      </div>
      <div style="background:rgba(212,168,75,.04);border:1px solid rgba(212,168,75,.2);border-radius:8px;padding:14px">
        <div style="font-size:11px;color:var(--gold);text-transform:uppercase;letter-spacing:1px;font-weight:600;margin-bottom:8px">🎯 Ваш сценарий</div>
        <div id="plMonthScenario"></div>
      </div>
    </div>
    <div id="plMonthEffect" style="margin-top:12px"></div>
  </div>

  <!-- Forecast 30-day chart -->
  <div class="card" style="margin-bottom:12px">
    <div class="ctitle">📈 Накопленная маржа за 30 дней</div>
    <div style="height:180px"><canvas id="fcC30"></canvas></div>
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
    <div class="ctitle">📊 Структура месячной нетто-выручки</div>
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
// ═══ API CONFIG v6.0 (Phase 2.3: no /api/query, only whitelisted endpoints) ═══
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

// Низкоуровневый GET с JWT и 401-handling. Используется всеми API-хелперами.
async function apiGet(path) {
  const jwt = getJWT();
  if (!jwt) { showLogin(); throw new Error('Not authenticated'); }
  const r = await fetch(API_BASE + path, {
    headers: { 'Authorization': 'Bearer ' + jwt }
  });
  if (r.status === 401) {
    clearJWT(); showLogin();
    throw new Error('Session expired');
  }
  const j = await r.json();
  if (!r.ok || j.error) throw new Error(j.message || j.error || ('HTTP ' + r.status));
  return j;
}

// GET /api/restaurants?full_history=0|1 — список ресторанов + ts
async function apiRestaurants(fullHistory) {
  const j = await apiGet('/api/restaurants?full_history=' + (fullHistory ? '1' : '0'));
  return j.data || [];
}

// GET /api/benchmarks?start=...&end=... — медианы сети и топ-10% за период
async function apiBenchmarks(startDate, endDate) {
  return await apiGet('/api/benchmarks?start=' + encodeURIComponent(startDate) + '&end=' + encodeURIComponent(endDate));
}

// GET /api/restaurant-meta?restaurant_id=N — score и рекомендации по точке
async function apiRestaurantMeta(restId) {
  return await apiGet('/api/restaurant-meta?restaurant_id=' + restId);
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
  dynStart: '',    dynEnd: '',
  cmpStart: '',    cmpEnd: '',
  dynGroup: 'day',
  cmpGroup: 'day',
  revMetric: 'revenue', dowMetric: 'revenue', dowFilter: 'all', compMetric: 'revenue',
  // #76 B: два сценария — будни и выходные. Каждый со своими 4 параметрами.
  plWdChk: 0, plWdCnt: 0, plWdFc: 0, plWdDisc: 0,
  plWeChk: 0, plWeCnt: 0, plWeFc: 0, plWeDisc: 0,
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
    const rows = await apiRestaurants(false);
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
    const rows = await apiRestaurants(true);
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
  S.restIdx = parseInt(idx);
  document.getElementById('mainSel').value = idx;
  // Синхронизируем первый слот Сравнения с выбранным рестораном
  const cs0 = document.getElementById('cs0'); if (cs0) cs0.value = idx;
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
      const meta = await apiRestaurantMeta(R.id);
      if (meta.score) RESTAURANT_SCORE = meta.score;
      RESTAURANT_RECS = meta.recommendations || [];
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
// Phase 2.3 (2026-04-21): SQL-агрегация перенесена на сервер (/api/benchmarks).
// Клиент передаёт только даты периода, сервер возвращает готовые NET и TOP10.
//
// В TOP10 сервер отдаёт p90 (выручка, avgCheck) и p25 (foodcost, discount —
// там "меньше = лучше"), чтобы семантика "лидеры" / "среднее" сохранилась.
async function loadNetworkBenchmarks(startDate, endDate) {
  try {
    const r = await apiBenchmarks(startDate, endDate);
    if (r.insufficient_data) {
      if (r.net && r.net.restCount !== undefined) NET.restCount = r.net.restCount;
      console.warn('[benchmarks] недостаточно ресторанов за период', startDate, endDate, '— показываем прочерки');
      return;
    }
    if (r.net) {
      NET.revenue     = r.net.revenue;
      NET.avgCheck    = r.net.avgCheck;
      NET.checks      = r.net.checks;
      NET.foodcost    = r.net.foodcost;
      NET.discount    = r.net.discount;
      NET.deliveryPct = r.net.deliveryPct;
      NET.restCount   = r.net.restCount;
    }
    if (r.top10) {
      TOP10.revenue     = r.top10.revenue;
      TOP10.avgCheck    = r.top10.avgCheck;
      TOP10.foodcost    = r.top10.foodcost;
      TOP10.discount    = r.top10.discount;
      TOP10.deliveryPct = r.top10.deliveryPct;
    }
  } catch(e) {
    console.error('[benchmarks] ошибка загрузки:', e.message);
  }
}

// ═══ Like-for-like профили по дням недели ═══
// Загружают за последние 90 дней:
//  • профиль сети: "типичный понедельник / вторник / ... в сети"
//  • профиль выбранного ресторана: "наша норма понедельника / вторника / ..."
// ClickHouse toDayOfWeek() возвращает 1..7 (1=Пн..7=Вс, ISO).
//
// Phase 2.1 (2026-04-21): SQL-логика перенесена на сервер (/api/dow-profiles).
// Клиент теперь просто забирает готовые агрегированные профили.
async function loadDowProfiles(restaurantId) {
  try {
    const jwt = getJWT();
    if (!jwt) { showLogin(); return; }
    const qs = restaurantId ? ('?restaurant_id=' + restaurantId) : '';
    const r = await fetch(API_BASE + '/api/dow-profiles' + qs, {
      headers: { 'Authorization': 'Bearer ' + jwt }
    });
    if (r.status === 401) { clearJWT(); showLogin(); return; }
    if (!r.ok) { console.error('[dow-profiles] HTTP ' + r.status); NET_DOW = {}; MY_DOW = {}; MY_DOW_DAYS = 0; return; }
    const j = await r.json();
    // Нормализация: ключи приходят строками, приводим профили к нужному виду.
    NET_DOW = {};
    for (const k of Object.keys(j.net || {})) NET_DOW[+k] = j.net[k];
    MY_DOW = {};
    for (const k of Object.keys(j.my || {})) MY_DOW[+k] = j.my[k];
    MY_DOW_DAYS = +j.my_days || 0;
  } catch(e) {
    console.error('[dow-profiles] error:', e.message);
    NET_DOW = {}; MY_DOW = {}; MY_DOW_DAYS = 0;
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

// ═══ FORECAST BLOCK (Phase 1.4 #71, Phase 2.2 2026-04-21) ═══
// Алгоритм Г (текущий месяц / прошлый год × k / 90-дневный DOW fallback)
// полностью перенесён на сервер. Клиент делает fetch и отрисовывает результат.

function jsToChDow(jsDow) { return jsDow === 0 ? 7 : jsDow; }

// Кэш прогнозов: ключ — restaurant_id или '__network__'.
// При смене ресторана / режима сеть — ищем в кэше; если нет — fetch.
const FORECAST_CACHE = {};
let FORECAST_INFLIGHT = null; // для отмены устаревших запросов

async function fetchForecast(restOrNull, networkMode) {
  const key = networkMode ? '__network__' : (restOrNull && restOrNull.id ? String(restOrNull.id) : null);
  if (!key) return null;
  if (FORECAST_CACHE[key]) return FORECAST_CACHE[key];

  const jwt = getJWT();
  if (!jwt) { showLogin(); return null; }

  const qs = networkMode ? '?network=1' : ('?restaurant_id=' + restOrNull.id);
  try {
    const r = await fetch(API_BASE + '/api/forecast' + qs, {
      headers: { 'Authorization': 'Bearer ' + jwt }
    });
    if (r.status === 401) { clearJWT(); showLogin(); return null; }
    if (!r.ok) { console.error('[forecast] HTTP ' + r.status); return null; }
    const j = await r.json();
    FORECAST_CACHE[key] = j;
    return j;
  } catch (e) {
    console.error('[forecast] error:', e.message);
    return null;
  }
}

function invalidateForecastCache() {
  for (const k of Object.keys(FORECAST_CACHE)) delete FORECAST_CACHE[k];
}

async function renderForecast() {
  const box = document.getElementById('forecastBox');
  if (!box || !R) { if(box) box.innerHTML = ''; return; }

  // Skeleton пока идёт запрос (первая отрисовка).
  // #dup-city fix: если R.name уже содержит R.city (напр. "Чико (Калининград-1)"),
  // то не клеим город вторым разом. Защита от пустого city тоже есть — пустая строка
  // всегда содержится в name, так что в этом случае city не добавляем.
  const cityInName = R.city && R.name.includes(R.city);
  const label = NETWORK_MODE ? \`Вся сеть (\${RESTS.length} ресторанов)\` : (cityInName ? R.name : R.name + ' (' + R.city + ')');
  const haveCache = FORECAST_CACHE[NETWORK_MODE ? '__network__' : String(R.id)];
  if (!haveCache) {
    box.innerHTML = \`<div class="fc-block"><div class="fc-hdr"><div class="fc-hdr-left"><span class="fc-lbl">Прогноз</span><span class="fc-sub">\${label}</span></div></div><div style="padding:24px;text-align:center;color:var(--text3);font-size:12px">Расчёт прогноза…</div></div>\`;
  }

  // Capture R/NETWORK_MODE для защиты от race condition
  const reqR = R, reqNet = NETWORK_MODE;
  const fc = await fetchForecast(reqR, reqNet);

  // Если за время запроса пользователь успел переключить ресторан — не перезатираем актуальное
  if (reqR !== R || reqNet !== NETWORK_MODE) return;
  if (!fc) {
    box.innerHTML = \`<div class="fc-block" style="padding:20px;color:var(--text3);font-size:12px">Не удалось загрузить прогноз</div>\`;
    return;
  }

  const pct = fc.total > 0 ? Math.round(fc.actual / fc.total * 100) : 0;
  const vsPrev = fc.prevMonthTotal > 0 ? ((fc.total - fc.prevMonthTotal) / fc.prevMonthTotal * 100) : null;
  const maxBar = Math.max(...fc.dailyBars.map(b => b.rev), 1);

  // Имя предыдущего месяца — берём из maxDate, пришедшего с сервера
  const fcMaxDate = fc.maxDate ? new Date(fc.maxDate) : new Date();
  const prevMonthIdx = (fcMaxDate.getMonth() - 1 + 12) % 12;
  const prevMonthName = MNAMES_FULL[prevMonthIdx] || '';

  // --- Precomputed for chart tooltips + x-axis labels (Обзор-polish 21.04) ---
  const fcYear = fcMaxDate.getFullYear();
  const fcMonthIdx = fcMaxDate.getMonth();
  const mon = fc.monthLabel.toLowerCase().slice(0,3);
  // Tooltip на каждый столбик: "15 апр (Пн) · 86 532 ₽ · факт"
  const barTip = (b) => {
    const dt = new Date(fcYear, fcMonthIdx, b.day);
    const dowLbl = DOW_NAMES[dt.getDay()];
    const typeLbl = b.type === 'actual' ? 'факт' : 'прогноз';
    return \`\${b.day} \${mon} (\${dowLbl}) · \${fmtR(b.rev, true)} · \${typeLbl}\`;
  };
  // Метки оси X: 1, 5, 10, 15, 20, 25, последний день. Для коротких месяцев
  // автоматически дедуплицируется (в феврале 28 не совпадает с 25, норм).
  const xLabels = [1, 5, 10, 15, 20, 25, fc.daysInMonth]
    .filter((d, i, arr) => d <= fc.daysInMonth && arr.indexOf(d) === i);
  // Tooltip на большое число «Итого»
  const bigTip = \`Итого за \${fc.monthLabel.toLowerCase()}: факт \${fmtR(fc.actual, true)} + прогноз \${fmtR(fc.remaining, true)}\`;
  // Tooltip на плашку «Выполнение»
  const donePctDays = Math.round(fc.daysElapsed / fc.daysInMonth * 100);
  const doneTip = \`Прошло \${fc.daysElapsed} из \${fc.daysInMonth} дней (\${donePctDays}% месяца). Выручка: \${pct}% от прогноза.\`;
  // Tooltip на плашку vs предыдущий месяц
  const vsTip = vsPrev !== null
    ? \`\${prevMonthName} завершён суммой \${fmtR(fc.prevMonthTotal, true)}. \${vsPrev >= 0 ? 'Текущий месяц идёт впереди' : 'Текущий месяц отстаёт'} на \${Math.abs(vsPrev).toFixed(1)}%.\`
    : 'Данных за прошлый месяц нет';

  box.innerHTML = \`<div class="fc-block">
    <div class="fc-hdr">
      <div class="fc-hdr-left">
        <span class="fc-lbl">Прогноз на \${fc.monthLabel}</span>
        <span class="fc-sub">\${label}</span>
      </div>
    </div>
    <div class="fc-row">
      <div>
        <div class="fc-big" title="\${bigTip}">\${fmtR(fc.total, true)}</div>
        <div class="fc-pair">
          <div class="fc-pair-item" title="Фактическая выручка с 1 по \${fc.daysElapsed} \${mon}, без прогноза">
            <div class="fc-pair-lbl">Факт (1–\${fc.daysElapsed} \${mon})</div>
            <div class="fc-pair-val" style="color:var(--text)">\${fmtR(fc.actual)}</div>
          </div>
          <div class="fc-pair-item" title="Прогнозная выручка с \${fc.daysElapsed+1} по \${fc.daysInMonth} \${mon} — метод: \${fc.method}">
            <div class="fc-pair-lbl">Прогноз (\${fc.daysElapsed+1}–\${fc.daysInMonth} \${mon})</div>
            <div class="fc-pair-val" style="color:var(--text2)">\${fmtR(fc.remaining)}</div>
          </div>
        </div>
      </div>
      <div class="fc-side">
        <div class="fc-side-card" title="\${doneTip}">
          <div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:1px">Выполнение</div>
          <div style="font-family:'Cormorant Garamond',serif;font-size:20px;font-weight:700;color:\${pct >= 50 ? 'var(--green)' : 'var(--amber)'}">\${pct}%</div>
          <div class="fc-pbar"><div class="fc-pbar-fill" style="width:\${Math.min(pct,100)}%;background:\${pct >= 50 ? 'var(--green)' : 'var(--amber)'}"></div></div>
        </div>
        <div class="fc-side-card" title="\${vsTip}">
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
      \`<div class="fc-chart-bar" title="\${barTip(b)}" style="height:\${Math.max(b.rev / maxBar * 100, 2)}%;background:\${b.type === 'actual' ? 'var(--blue)' : 'rgba(212,168,75,.35)'};border:\${b.type === 'forecast' ? '1px dashed var(--gold)' : 'none'}"></div>\`
    ).join('')}</div>
    <div style="position:relative;height:14px;margin-top:2px">\${xLabels.map(d =>
      \`<span style="position:absolute;left:\${((d - 0.5) / fc.daysInMonth * 100).toFixed(2)}%;transform:translateX(-50%);font-size:10px;color:var(--text3);white-space:nowrap">\${d} \${mon}</span>\`
    ).join('')}</div>
    <div style="text-align:center;font-size:10px;color:var(--text2);margin-top:2px">← факт · прогноз →</div>
    <div class="fc-method">Метод: \${fc.method}</div>
  </div>\`;
}

function renderAll() {
  renderForecast();
  renderKPIs();
  renderMiniTrend();
  renderInsights();
  renderAlerts();
  // Пересчитываем все вкладки при смене ресторана / «Вся сеть»
  if (typeof renderDynamics === 'function') try { renderDynamics(); } catch(e) { console.warn('[renderAll] dynamics:', e.message); }
  if (typeof renderCompare === 'function') try { renderCompare(); } catch(e) { console.warn('[renderAll] compare:', e.message); }
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
  // #48: в длинном формате неразрывный пробел перед ₽ — стандарт русской
  // типографики. Короткий формат (154К₽, 1.5М₽) оставляем плотным — он
  // используется в компактных местах (KPI-карточки, подписи графиков).
  // toLocaleString('ru') уже вставляет NBSP как разделитель тысяч,
  // поэтому итог: "153 124 ₽" (все пробелы неразрывные).
  return Math.round(v).toLocaleString('ru')+'\u00A0₽';
}
function fmtN(v,d=1){return v===null||v===undefined?'—':Number(v).toFixed(d)}
function fmtD(dateStr){if(!dateStr||dateStr.length<10)return dateStr||'';return dateStr.slice(8,10)+'.'+dateStr.slice(5,7)}
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

  // Trend analysis: DOW-normalized (like-for-like)
  // Сравниваем не сырые Чт<Пт<Сб (бессмысленно), а отклонение от DOW-нормы
  let declining3 = false, growing3 = false;
  const last3 = ts.slice(-3);
  let devs = [null, null, null];
  if (daysN >= 7 && last3.length >= 3 && cmpBase) {
    devs = last3.map(t => {
      const jsDow = new Date(t.date).getDay();
      const chDow = jsDow === 0 ? 7 : jsDow;
      const norm = (bm.haveMy && MY_DOW[chDow]) ? MY_DOW[chDow].rev_p50
                 : (NET_DOW[chDow] ? NET_DOW[chDow].rev_p50 : null);
      return norm && norm > 0 ? (t.revenue - norm) / norm : null;
    });
    if (devs.every(d => d !== null)) {
      declining3 = devs[0] > devs[1] && devs[1] > devs[2] && devs[2] < -0.05;
      growing3   = devs[0] < devs[1] && devs[1] < devs[2] && devs[2] > 0.05;
    }
  }

  const msgs = [];

  // ФУДКОСТ — без изменений по порогам (22% норма / 26% критично для Chicko),
  // но с добавлением периода и like-for-like сравнением
  if (cur.foodcost!==null && cur.foodcost>26) {
    msgs.push({c:'a-red', t:\`🔴 <b>Критический фудкост: \${fmtN(cur.foodcost)}%</b> — превышает норму 22% на \${fmtN(cur.foodcost-22)} п.п. (среднее \${periodTxt}). Потери ~\${fmtR((cur.foodcost-22)/100*cur.revenue)}/день.\`});
  } else if (cur.foodcost!==null && cur.foodcost>22) {
    msgs.push({c:'a-amber', t:\`⚠️ <b>Фудкост \${fmtN(cur.foodcost)}% выше нормы</b> (норма до 22%), среднее \${periodTxt}. Снижение до 22% высвободит ~\${fmtR((cur.foodcost-22)/100*cur.revenue)}/день.\`});
  }

  // Тренд (DOW-normalized)
  if (declining3) {
    const dowNames = ['','Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
    const detail = last3.map((t,i) => {
      const chDow = jsToChDow(new Date(t.date).getDay());
      return dowNames[chDow]+': '+(devs[i]*100).toFixed(0)+'%';
    }).join(', ');
    msgs.push({c:'a-red', t:\`📉 <b>Выручка ниже DOW-нормы 3 дня подряд</b> (\${detail}). Это не сезонный спад — ресторан недорабатывает относительно своих же показателей.\`});
  } else if (growing3) {
    const dowNames = ['','Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
    const detail = last3.map((t,i) => {
      const chDow = jsToChDow(new Date(t.date).getDay());
      return dowNames[chDow]+': +'+(devs[i]*100).toFixed(0)+'%';
    }).join(', ');
    msgs.push({c:'a-green', t:\`📈 <b>Выручка выше DOW-нормы 3 дня подряд</b> (\${detail}). Реальный рост — зафиксируйте что сработало.\`});
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

  // #43: скрыть доставку если у ресторана нет доставки
  const delCard = document.getElementById('kcard-del');
  if (delCard) {
    const hasDelivery = ts.some(t => t.delivery > 0 || t.deliveryPct > 1);
    delCard.style.display = hasDelivery ? '' : 'none';
  }
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
  mkChart('miniC',{type:'line',data:{labels:ts.map(t=>fmtD(t.date)),datasets:[{label:'Ваша выручка',data:ts.map(t=>t.revenue),borderColor:'#D4A84B',backgroundColor:'rgba(212,168,75,.07)',borderWidth:2,pointRadius:2,fill:true,tension:.3},{data:ts.map(()=>NET.revenue),borderColor:'rgba(142,170,206,.3)',borderDash:[4,4],borderWidth:1.5,pointRadius:0,fill:false,label:'Медиана сети'}]},options:{...chartOpts(v=>fmtR(v)),plugins:{legend:{display:true,position:'top',align:'end',labels:{boxWidth:10,boxHeight:2,font:{size:10},color:'rgba(212,222,235,.6)',padding:6}}}}});
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
// ═══ DYNAMICS (Фаза 1.5) ═══

function setDynGroup(mode,btn){
  S.dynGroup=mode;
  document.querySelectorAll('#dynGroupBtns .pbtn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  renderDynamics();
}
function setRevM(m,btn){S.revMetric=m;document.querySelectorAll('#revMBtns .mtbtn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');renderRevChart()}
function setDOWMet(m,btn){S.dowMetric=m;document.querySelectorAll('#dowMetBtns .mtbtn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');renderDOW()}
function setDowFilter(f,btn){S.dowFilter=f;document.querySelectorAll('#dowFilterBtns .pbtn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');renderDowFilter()}

function groupTs(ts, mode) {
  if (mode === 'day' || !mode) return ts;
  const groups = {};
  for (const t of ts) {
    let key;
    if (mode === 'week') {
      const d = new Date(t.date);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      const mon = new Date(d.getFullYear(), d.getMonth(), diff);
      key = mon.toISOString().slice(0,10);
    } else if (mode === 'month') {
      key = t.date.slice(0,7);
    } else if (mode === 'quarter') {
      const m = parseInt(t.date.slice(5,7));
      key = t.date.slice(0,4) + '-Q' + Math.ceil(m/3);
    } else if (mode === 'year') {
      key = t.date.slice(0,4);
    }
    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  }
  const MLBL = ['','Янв','Фев','Мар','Апр','Май','Июн','Июл','Авг','Сен','Окт','Ноя','Дек'];
  return Object.entries(groups).sort((a,b)=>a[0].localeCompare(b[0])).map(([key, items]) => {
    const totalRev = items.reduce((s,t) => s + t.revenue, 0);
    const totalChecks = items.reduce((s,t) => s + t.checks, 0);
    let label = key;
    if (mode === 'week') { const d=new Date(key); label=d.getDate()+' '+MLBL[d.getMonth()+1]; }
    else if (mode === 'month') { const m=parseInt(key.slice(5,7)); label=MLBL[m]+' '+key.slice(2,4); }
    else if (mode === 'quarter') { label=key.replace('-',' '); }
    return {
      date: key,
      label,
      revenue: totalRev,
      bar: items.reduce((s,t) => s + (t.bar||0), 0),
      kitchen: items.reduce((s,t) => s + (t.kitchen||0), 0),
      delivery: items.reduce((s,t) => s + (t.delivery||0), 0),
      avgCheck: totalChecks > 0 ? totalRev / totalChecks : 0,
      checks: totalChecks,
      foodcost: totalRev > 0 ? items.reduce((s,t) => s + (t.foodcost||0) * t.revenue, 0) / totalRev : 0,
      discount: totalRev > 0 ? items.reduce((s,t) => s + (t.discount||0) * t.revenue, 0) / totalRev : 0,
      deliveryPct: totalRev > 0 ? items.reduce((s,t) => s + (t.delivery||0), 0) / totalRev * 100 : 0,
      itemsPerCheck: 0,
      _days: items.length,
    };
  });
}

function getDynTs(){
  const ts = getTsRange(R, S.dynStart, S.dynEnd);
  return groupTs(ts, S.dynGroup);
}
function getDynTsRaw(){
  return getTsRange(R, S.dynStart, S.dynEnd);
}

function getNetGroupedTs(){
  // Build real network ts grouped the same way as current view
  // Normalized to per-restaurant average (for fair comparison with single restaurant)
  if (NETWORK_MODE) return null; // уже смотрим сеть — линия сети не нужна
  const netR = buildNetworkR();
  const netRaw = getTsRange(netR, S.dynStart, S.dynEnd);
  const grouped = groupTs(netRaw, S.dynGroup);
  const nRest = RESTS.length || 1;
  // Для суммируемых метрик делим на кол-во ресторанов, для % оставляем как есть
  return grouped.map(t => ({
    ...t,
    revenue: t.revenue / nRest,
    bar: t.bar / nRest,
    kitchen: t.kitchen / nRest,
    delivery: t.delivery / nRest,
    checks: t.checks / nRest,
    // avgCheck, foodcost, discount — уже средние, не делим
  }));
}

function renderDynamics(){
  const netTs = getNetGroupedTs();
  renderRevChart(netTs);
  renderLineChart2('chkC','avgCheck','#4A9EF5','Средний чек',netTs,v=>fmtR(v));
  renderLineChart2('cntC','checks','#9B59B6','Чеков',netTs,null);
  renderLineChart2('fcC','foodcost','#F39C12','Фудкост %',netTs,null);
  renderLineChart2('discC','discount','#E74C3C','Скидки %',netTs,null);
  renderDOW();
  renderDowFilter();
  renderDynStats();
}
function renderRevChart(netTs){
  const groupLabels={day:'дням',week:'неделям',month:'месяцам',quarter:'кварталам',year:'годам'};
  const ttl=document.getElementById('revChartTitle');
  if(ttl) ttl.innerHTML='💰 Выручка по '+(groupLabels[S.dynGroup]||'дням');
  const ts=getDynTs();
  const mc={revenue:'#D4A84B',kitchen:'#4A9EF5',bar:'#9B59B6',delivery:'#2ECC71'};
  const ml={revenue:'Общая',kitchen:'Кухня',bar:'Бар',delivery:'Доставка'};
  const lbls = ts.map(t => t.label || fmtD(t.date));
  const metric = S.revMetric;
  const datasets = [{label:ml[metric],data:ts.map(t=>t[metric]||0),backgroundColor:mc[metric]+'99',borderColor:mc[metric],borderWidth:1,borderRadius:4}];
  // Линия сети — реальные данные за тот же период
  if (netTs && netTs.length) {
    const netMap = {};
    netTs.forEach(t => { netMap[t.date] = t; });
    datasets.push({label:'Сеть',data:ts.map(t=> { const n=netMap[t.date]; return n ? (n[metric]||0) : 0; }),type:'line',borderColor:'rgba(142,170,206,.5)',borderDash:[4,4],borderWidth:1.5,pointRadius:0,fill:false});
  }
  const opts = chartOpts(v=>fmtR(v));
  // Tooltip: доля от выручки для Кухня/Бар/Доставка
  if (metric !== 'revenue') {
    opts.plugins.tooltip = {callbacks:{label:function(ctx){
      const val = ctx.raw || 0;
      const idx = ctx.dataIndex;
      const total = ts[idx] ? ts[idx].revenue : 0;
      const pct = total > 0 ? (val/total*100).toFixed(1) : '0';
      return ctx.dataset.label+': '+fmtR(val)+' ('+pct+'% выручки)';
    }}};
  }
  mkChart('revC',{type:'bar',data:{labels:lbls,datasets},options:opts});
}
function renderLineChart2(id,key,color,label,netTs,yCb){
  const ts=getDynTs().filter(t=>t[key]!==null&&t[key]!==undefined);
  const lbls = ts.map(t => t.label || fmtD(t.date));
  const ds=[{label,data:ts.map(t=>t[key]||0),borderColor:color,backgroundColor:color+'22',borderWidth:2,pointRadius:ts.length>50?0:3,pointBackgroundColor:color,fill:true,tension:.3}];
  // Линия сети — реальные данные
  if (netTs && netTs.length) {
    const netMap = {};
    netTs.forEach(t => { netMap[t.date] = t; });
    ds.push({label:'Сеть',data:ts.map(t=> { const n=netMap[t.date]; return n ? (n[key]||0) : 0; }),borderColor:'rgba(142,170,206,.5)',borderDash:[4,4],borderWidth:1.5,pointRadius:0,fill:false});
  }
  mkChart(id,{type:'line',data:{labels:lbls,datasets:ds},options:chartOpts(yCb||null)});
}

function renderDOW(){
  const ts=getDynTsRaw();
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
  const ts=getDynTsRaw();
  const f=S.dowFilter;
  const DOW_MAP={all:null,weekday:[1,2,3,4,5],weekend:[0,6],mon:[1],tue:[2],wed:[3],thu:[4],fri:[5],sat:[6],sun:[0]};
  const allowed=DOW_MAP[f];
  const filtered=allowed?ts.filter(t=>allowed.includes(getDOW(t.date))):ts;
  if(!filtered.length){document.getElementById('dowStats').textContent='Нет данных для выбранного фильтра';return;}

  const avgR=avgArr(filtered.map(t=>t.revenue));
  const avgC=avgArr(filtered.map(t=>t.avgCheck));
  const avgCnt=avgArr(filtered.map(t=>t.checks));
  document.getElementById('dowStats').innerHTML=\`<span style="color:var(--text2)">Среднее за выбранный фильтр:</span> выручка <b style="color:var(--gold)">\${fmtR(avgR)}</b> · чек <b style="color:var(--gold)">\${fmtR(avgC)}</b> · чеков <b style="color:var(--gold)">\${Math.round(avgCnt)}</b> · дней: \${filtered.length}\`;

  mkChart('dowFilterC',{type:'line',data:{labels:filtered.map(t=>fmtD(t.date)+' ('+DOW_NAMES[getDOW(t.date)]+')'),datasets:[{label:'Выручка',data:filtered.map(t=>t.revenue),borderColor:'#D4A84B',backgroundColor:'rgba(212,168,75,.1)',borderWidth:2,pointRadius:4,fill:true,tension:.2}]},options:{...chartOpts(v=>fmtR(v)),plugins:{legend:{display:false}}}});
}

function renderDynStats(){
  const ts=getDynTs();
  const metrics=[{k:'revenue',l:'Выручка',f:fmtR,lb:false},{k:'avgCheck',l:'Ср. чек',f:fmtR,lb:false},{k:'checks',l:'Чеков',f:v=>Math.round(v),lb:false},{k:'foodcost',l:'Фудкост %',f:v=>v!==null?fmtN(v)+'%':'—',lb:true},{k:'discount',l:'Скидки %',f:v=>fmtN(v)+'%',lb:true}];
  document.getElementById('dynStatB').innerHTML=metrics.map(m=>{
    const vals=ts.map(t=>t[m.k]).filter(v=>v!==null&&v!==undefined&&v>0);
    if(!vals.length) return '';
    const mn=Math.min(...vals),mx=Math.max(...vals),avg=avgArr(vals),last=vals[vals.length-1],prev2=vals.length>=2?vals[vals.length-2]:null;
    let trend='';
    if(prev2!==null){
      const went_up=last>prev2, went_dn=last<prev2;
      if(went_up||went_dn){
        const good=m.lb?went_dn:went_up;
        trend=\`<span class="\${good?'up':'dn'}">\${good?'▲':'▼'} \${Math.abs(((last-prev2)/prev2)*100).toFixed(1)}%</span>\`;
      } else { trend='<span class="nt">→</span>'; }
    }
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
        \${RESTS.map((r,j)=>\`<option value="\${j}" \${i===0&&j===S.restIdx?'selected':''}>\${r.city}</option>\`).join('')}
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
function getCmpTs(r){return groupTs(getTsRange(r,S.cmpStart,S.cmpEnd), S.cmpGroup)}
function getCompMetVal(r2,m){
  const ts=getCmpTs(r2);
  if(!ts.length) return 0;
  if(m==='delivPct'){const r=safeAvg(ts,'revenue')||1,d=safeAvg(ts,'delivery')||0;return d/r*100;}
  return safeAvg(ts,m)||0;
}

function setCmpGroup(mode,btn){S.cmpGroup=mode;document.querySelectorAll('#cmpGroupBtns .pbtn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');renderCompare()}
function setCmpM(m,btn){S.compMetric=m;document.querySelectorAll('#compMBtns .mtbtn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');renderCompare()}
function renderCompare(){
  const comps=getCompRests();
  if(!comps.length) return;
  const groupLabels={day:'дням',week:'неделям',month:'месяцам',quarter:'кварталам',year:'годам'};
  const trTitle=document.getElementById('cmpTrTitle');
  if(trTitle) trTitle.innerHTML='📈 Тренд выручки по '+(groupLabels[S.cmpGroup]||'дням');
  const isRub=['revenue','avgCheck'].includes(S.compMetric);
  const netVals={revenue:NET.revenue,avgCheck:NET.avgCheck,checks:NET.checks,foodcost:NET.foodcost,discount:NET.discount,delivPct:NET.deliveryPct};

  mkChart('cmpBarC',{type:'bar',data:{
    labels:comps.map(r2=>r2.city),
    datasets:[
      {data:comps.map(r2=>getCompMetVal(r2,S.compMetric)),backgroundColor:comps.map((_,i)=>COMP_COLORS[i]+'99'),borderColor:comps.map((_,i)=>COMP_COLORS[i]),borderWidth:1,borderRadius:4},
      {label:'Сеть',data:comps.map(()=>netVals[S.compMetric]),type:'line',borderColor:'rgba(142,170,206,.4)',borderDash:[4,4],borderWidth:1.5,pointRadius:0,fill:false}
    ]
  },options:{...chartOpts(v=>isRub?fmtR(v):v),plugins:{legend:{display:false}}}});

  const baseDates=getCmpTs(comps[0]).map(t=>t.label||fmtD(t.date));
  mkChart('cmpTrC',{type:'line',data:{labels:baseDates,datasets:comps.map((r2,i)=>({label:r2.city,data:getCmpTs(r2).map(t=>t.revenue),borderColor:COMP_COLORS[i],backgroundColor:COMP_COLORS[i]+'15',borderWidth:i===0?2.5:1.5,pointRadius:i===0?3:2,fill:false,tension:.3}))},options:chartOpts(v=>fmtR(v))});

  const metrics=[{k:'revenue',l:'Выручка',f:fmtR,lb:false},{k:'avgCheck',l:'Ср. чек',f:fmtR,lb:false},{k:'checks',l:'Чеков/день',f:v=>Math.round(v),lb:false},{k:'foodcost',l:'Фудкост %',f:v=>v!==null?fmtN(v)+'%':'—',lb:true},{k:'discount',l:'Скидки %',f:v=>fmtN(v)+'%',lb:true},{k:'delivPct',l:'Доставка %',f:v=>fmtN(v,1)+'%',lb:false}];
  document.getElementById('cmpTH').innerHTML=\`<tr><th>Метрика</th>\${comps.map((r2,i)=>\`<th style="color:\${COMP_COLORS[i]}">\${r2.city}</th>\`).join('')}</tr>\`;
  document.getElementById('cmpTB').innerHTML=metrics.map(m=>{
    const vals=comps.map(r2=>getCompMetVal(r2,m.k));
    const validVals=vals.filter(v=>v!==null&&v!==undefined&&v>0);
    const best=validVals.length?(m.lb?Math.min(...validVals):Math.max(...validVals)):null;
    return \`<tr><td class="c-m">\${m.l}</td>\${comps.map((r2,i)=>{
      const v=vals[i];
      const isLeader=best!==null&&v===best&&validVals.length>1;
      return \`<td style="color:\${COMP_COLORS[i]};font-weight:\${i===0?600:400};\${isLeader?'background:rgba(46,204,113,.12);border-radius:4px':''}"><span>\${isLeader?'🏆 ':''}\${m.f(v)}</span></td>\`;
    }).join('')}</tr>\`;
  }).join('');

  const r=comps[0],dp=r.revenue>0?r.delivery/r.revenue*100:0;
  // #43 extension: если у ресторана доставки нет (≤1%) — не показываем строку
  // в таблице vs Сеть/ТОП-10. KPI-карточка скрывается отдельно (см. выше).
  const hasDelivery = dp > 1;
  const rows=[{l:'Выручка/день',s:r.revenue,n:NET.revenue,t:TOP10.revenue,f:fmtR,lb:false},{l:'Ср. чек',s:r.avgCheck,n:NET.avgCheck,t:TOP10.avgCheck,f:fmtR,lb:false},{l:'Чеков/день',s:r.checks,n:NET.checks,t:null,f:v=>Math.round(v),lb:false},{l:'Фудкост %',s:r.foodcost,n:NET.foodcost,t:TOP10.foodcost,f:v=>v!==null?fmtN(v)+'%':'—',lb:true},{l:'Скидки %',s:r.discount,n:NET.discount,t:TOP10.discount,f:v=>fmtN(v,1)+'%',lb:true}];
  if (hasDelivery) rows.push({l:'Доставка %',s:dp,n:NET.deliveryPct,t:TOP10.deliveryPct,f:v=>fmtN(v,1)+'%',lb:false});
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
// #76 B: калькулятор маржи с разбивкой на будни/выходные. Инициализируем
// 8 ползунков из реальных средних по wd/we дням в выбранном периоде. Факт
// месяца считается честно: 22 будних дня × маржа будни + 8 выходных × маржа выходные.
function renderAnalysis(){
  renderWDB();
  const ts=getGlobalTs();
  const wdTs=ts.filter(t=>!isWeekend(t.date));
  const weTs=ts.filter(t=>isWeekend(t.date));

  // Будни — средние. Если данных нет (например, выбран только выходной день) — fallback к среднему по всем дням.
  const wdChk=safeAvg(wdTs,'avgCheck')||safeAvg(ts,'avgCheck')||R.avgCheck||1400;
  const wdCnt=safeAvg(wdTs,'checks')||safeAvg(ts,'checks')||R.checks||80;
  const wdFc=safeAvg(wdTs,'foodcost')||safeAvg(ts,'foodcost')||NET.foodcost||23;
  const wdDisc=safeAvg(wdTs,'discount')||safeAvg(ts,'discount')||R.discount||7;

  // Выходные — аналогично
  const weChk=safeAvg(weTs,'avgCheck')||safeAvg(ts,'avgCheck')||R.avgCheck||1400;
  const weCnt=safeAvg(weTs,'checks')||safeAvg(ts,'checks')||R.checks||80;
  const weFc=safeAvg(weTs,'foodcost')||safeAvg(ts,'foodcost')||NET.foodcost||23;
  const weDisc=safeAvg(weTs,'discount')||safeAvg(ts,'discount')||R.discount||7;

  // Сохраняем как FACT baseline для сравнения «факт vs сценарий»
  S.plWdChk=wdChk;S.plWdCnt=wdCnt;S.plWdFc=wdFc;S.plWdDisc=wdDisc;
  S.plWeChk=weChk;S.plWeCnt=weCnt;S.plWeFc=weFc;S.plWeDisc=weDisc;

  // Инициализируем ползунки
  document.getElementById('sl-wd-chk').value=Math.round(wdChk);
  document.getElementById('sl-wd-cnt').value=Math.round(wdCnt);
  document.getElementById('sl-wd-fc').value=wdFc;
  document.getElementById('sl-wd-disc').value=wdDisc;

  document.getElementById('sl-we-chk').value=Math.round(weChk);
  document.getElementById('sl-we-cnt').value=Math.round(weCnt);
  document.getElementById('sl-we-fc').value=weFc;
  document.getElementById('sl-we-disc').value=weDisc;

  calcPL();
}
function resetPL(){renderAnalysis()}

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
    labels:ts.map(t=>fmtD(t.date)+' '+DOW_NAMES[getDOW(t.date)]),
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

// #76: упрощение P&L калькулятора (21.04.2026).
// ФОТ 25% и Аренда 15% были захардкожены и одинаковы для всех ресторанов —
// это модельные допущения без реальных данных. Блок назывался «ФАКТ», но
// по факту был моделью. Полный P&L с реальными ФОТ/арендой/прочим будет
// в отдельной вкладке после подключения 1С (Волна 6). Здесь — честная
// маржа до прочих расходов, на основе только реальных данных из iiko.
function plCalc(chk,cnt,fc,disc) {
  const rev = chk*cnt;
  const discAmt = rev*disc/100;
  const net = rev - discAmt;
  const fcAmt = net*fc/100;
  const margin = net - fcAmt; // Маржа до прочих расходов (ФОТ, аренда, коммуналка и т.д.)
  return { rev, discAmt, net, fcAmt, margin };
}
function plHtml_DEPRECATED_REMOVED_v76b(){ /* удалено в #76 B */ }

// #76 B: два сценария — будни и выходные. Фиксированное количество дней
// в среднем месяце: 22 будних + 8 выходных = 30 календарных дней.
// Это усреднение для 30-31-дневного месяца (реально бывает 20-23 будних).
// Реальная разбивка за период использована для инициализации ползунков в
// renderAnalysis, здесь для месячных итогов — стандартная структура.
const PL_WD_DAYS = 22;
const PL_WE_DAYS = 8;

function calcPL(){
  const slWdChk = document.getElementById('sl-wd-chk');
  if(!slWdChk) return; // Analysis tab not rendered yet

  // Читаем 8 ползунков
  const wdChk = +slWdChk.value;
  const wdCnt = +document.getElementById('sl-wd-cnt').value;
  const wdFc  = +document.getElementById('sl-wd-fc').value;
  const wdDisc= +document.getElementById('sl-wd-disc').value;
  const weChk = +document.getElementById('sl-we-chk').value;
  const weCnt = +document.getElementById('sl-we-cnt').value;
  const weFc  = +document.getElementById('sl-we-fc').value;
  const weDisc= +document.getElementById('sl-we-disc').value;

  // Подписи около ползунков
  document.getElementById('sl-wd-chk-v').textContent = fmtR(wdChk);
  document.getElementById('sl-wd-cnt-v').textContent = wdCnt;
  document.getElementById('sl-wd-fc-v').textContent  = fmtN(wdFc,1);
  document.getElementById('sl-wd-disc-v').textContent= fmtN(wdDisc,1);
  document.getElementById('sl-we-chk-v').textContent = fmtR(weChk);
  document.getElementById('sl-we-cnt-v').textContent = weCnt;
  document.getElementById('sl-we-fc-v').textContent  = fmtN(weFc,1);
  document.getElementById('sl-we-disc-v').textContent= fmtN(weDisc,1);

  // Посчитать маржу в день для каждого сценария (и его факта)
  const wdScen = plCalc(wdChk, wdCnt, wdFc, wdDisc);
  const weScen = plCalc(weChk, weCnt, weFc, weDisc);
  const wdFact = plCalc(S.plWdChk, S.plWdCnt, S.plWdFc, S.plWdDisc);
  const weFact = plCalc(S.plWeChk, S.plWeCnt, S.plWeFc, S.plWeDisc);

  // Обновить компактные «Маржа/будний день» и «Маржа/выходной день»
  document.getElementById('pl-wd-margin').textContent = fmtR(wdScen.margin);
  document.getElementById('pl-we-margin').textContent = fmtR(weScen.margin);

  // Месячные итоги (честное сложение)
  const factMonth = wdFact.margin * PL_WD_DAYS + weFact.margin * PL_WE_DAYS;
  const scenMonth = wdScen.margin * PL_WD_DAYS + weScen.margin * PL_WE_DAYS;
  const factRevMonth = wdFact.rev * PL_WD_DAYS + weFact.rev * PL_WE_DAYS;
  const scenRevMonth = wdScen.rev * PL_WD_DAYS + weScen.rev * PL_WE_DAYS;

  // Рендер блока «Факт» (левая колонка итога месяца)
  document.getElementById('plMonthFactual').innerHTML = \`
    <div class="pl-r" title="Реальные средние значения из выбранного периода"><span class="pl-lbl">📅 Будни: \${PL_WD_DAYS} × \${fmtR(wdFact.margin)}</span><span class="pl-amt" style="color:var(--blue)">\${fmtR(wdFact.margin * PL_WD_DAYS)}</span></div>
    <div class="pl-r"><span class="pl-lbl">🎉 Выходные: \${PL_WE_DAYS} × \${fmtR(weFact.margin)}</span><span class="pl-amt" style="color:var(--gold)">\${fmtR(weFact.margin * PL_WE_DAYS)}</span></div>
    <div class="pl-tot"><span class="pl-tot-lbl">Маржа/месяц</span><span class="pl-tot-amt" style="color:var(--blue)">\${fmtR(factMonth)}</span></div>
    <div style="font-size:10px;color:var(--text3);text-align:right;margin-top:4px">Выручка/мес: \${fmtR(factRevMonth)} · Год: \${fmtR(factMonth*12)}</div>\`;

  // Рендер блока «Сценарий» (правая колонка итога месяца)
  document.getElementById('plMonthScenario').innerHTML = \`
    <div class="pl-r"><span class="pl-lbl">📅 Будни: \${PL_WD_DAYS} × \${fmtR(wdScen.margin)}</span><span class="pl-amt" style="color:var(--blue)">\${fmtR(wdScen.margin * PL_WD_DAYS)}</span></div>
    <div class="pl-r"><span class="pl-lbl">🎉 Выходные: \${PL_WE_DAYS} × \${fmtR(weScen.margin)}</span><span class="pl-amt" style="color:var(--gold)">\${fmtR(weScen.margin * PL_WE_DAYS)}</span></div>
    <div class="pl-tot"><span class="pl-tot-lbl">Маржа/месяц</span><span class="pl-tot-amt" style="color:var(--gold)">\${fmtR(scenMonth)}</span></div>
    <div style="font-size:10px;color:var(--text3);text-align:right;margin-top:4px">Выручка/мес: \${fmtR(scenRevMonth)} · Год: \${fmtR(scenMonth*12)}</div>\`;

  // Эффект: дельта между фактом и сценарием
  const deltaMonth = scenMonth - factMonth;
  const deltaYear = deltaMonth * 12;
  const deltaColor = deltaMonth >= 0 ? 'var(--green)' : 'var(--red)';
  const deltaSign = deltaMonth >= 0 ? '+' : '';
  document.getElementById('plMonthEffect').innerHTML = \`
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px">
      <div style="background:var(--card2);border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Эффект за месяц</div>
        <div style="font-family:'Cormorant Garamond',serif;font-size:22px;font-weight:700;color:\${deltaColor}">\${deltaSign}\${fmtR(deltaMonth)}</div>
      </div>
      <div style="background:var(--card2);border:1px solid var(--border);border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:9px;color:var(--text3);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Эффект за год</div>
        <div style="font-family:'Cormorant Garamond',serif;font-size:22px;font-weight:700;color:\${deltaColor}">\${deltaSign}\${fmtR(deltaYear)}</div>
      </div>
    </div>\`;

  // 30-day chart: накопленная маржа. Для простоты используем ежедневную
  // blended маржу (wd_margin * 22/30 + we_margin * 8/30) как линейное
  // приближение. Итоговые точки на 30-й день совпадают с месячными итогами.
  const factDailyBlend = factMonth / 30;
  const scenDailyBlend = scenMonth / 30;
  const days = Array.from({length:30}, (_,i)=>i+1);
  mkChart('fcC30', {type:'line', data:{labels:days.map(d=>d+'д'), datasets:[
    {label:'Текущий факт', data:days.map(d=>factDailyBlend*d), borderColor:'#4A9EF5', backgroundColor:'rgba(74,158,245,.08)', borderWidth:2, pointRadius:0, fill:true, tension:.3},
    {label:'Ваш сценарий', data:days.map(d=>scenDailyBlend*d), borderColor:'#D4A84B', backgroundColor:'rgba(212,168,75,.08)', borderWidth:2, pointRadius:0, fill:true, tension:.3},
    {label:'Ноль', data:days.map(()=>0), borderColor:'rgba(142,170,206,.2)', borderWidth:1, pointRadius:0, fill:false, borderDash:[2,4]}
  ]}, options:chartOpts(v=>fmtR(v))});

  // Breakeven — заглушка как было (требует ФОТ/Аренда из 1С)
  document.getElementById('breakevenBox').innerHTML = \`
    <div style="text-align:center;padding:24px 12px;color:var(--text3);font-size:12px;line-height:1.6">
      <div style="font-size:24px;margin-bottom:8px">🔒</div>
      <div style="color:var(--text2);font-weight:500;margin-bottom:6px">Точка безубыточности временно недоступна</div>
      <div style="font-size:11px">Для корректного расчёта нужны реальные ФОТ, аренда и прочие постоянные расходы. Появится после подключения 1С <b>(Волна 6)</b>.</div>
    </div>\`;

  // Сценарии улучшений — применяются и к будням, и к выходным отдельно,
  // показываем суммарный месячный эффект
  const mkScen = (wdMod, weMod, label) => {
    const newMonth = wdMod().margin * PL_WD_DAYS + weMod().margin * PL_WE_DAYS;
    return { l: label, delta: newMonth - scenMonth };
  };
  document.getElementById('scenBox').innerHTML = [
    mkScen(
      () => plCalc(wdChk, wdCnt*1.1, wdFc, wdDisc),
      () => plCalc(weChk, weCnt*1.1, weFc, weDisc),
      '+10% чеков (и будни и выходные)'
    ),
    mkScen(
      () => plCalc(wdChk, wdCnt, Math.max(0, wdFc-1), wdDisc),
      () => plCalc(weChk, weCnt, Math.max(0, weFc-1), weDisc),
      '−1% фудкост'
    ),
    mkScen(
      () => plCalc(wdChk, wdCnt, wdFc, Math.max(0, wdDisc-1)),
      () => plCalc(weChk, weCnt, weFc, Math.max(0, weDisc-1)),
      '−1% скидок'
    ),
    mkScen(
      () => plCalc(wdChk+100, wdCnt, wdFc, wdDisc),
      () => plCalc(weChk+100, weCnt, weFc, weDisc),
      '+100₽ к среднему чеку'
    ),
    { l: 'Будни подтянуть до уровня выходных', delta: (weScen.margin - wdScen.margin) * PL_WD_DAYS },
  ].map(s => \`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid rgba(46,64,104,.4);font-size:11px"><span style="color:var(--text2)">\${s.l}</span><span style="color:\${s.delta>=0?'var(--green)':'var(--red)'};font-weight:600">\${s.delta>=0?'+':''}\${fmtR(s.delta)}/мес</span></div>\`).join('');

  // Stacked bar: структура МЕСЯЧНОЙ нетто-выручки, с учётом веса wd/we
  const factDisc = wdFact.discAmt * PL_WD_DAYS + weFact.discAmt * PL_WE_DAYS;
  const factFc   = wdFact.fcAmt * PL_WD_DAYS + weFact.fcAmt * PL_WE_DAYS;
  const scenDisc = wdScen.discAmt * PL_WD_DAYS + weScen.discAmt * PL_WE_DAYS;
  const scenFc   = wdScen.fcAmt * PL_WD_DAYS + weScen.fcAmt * PL_WE_DAYS;

  mkChart('plBarC', {type:'bar', data:{labels:['Факт','Сценарий'], datasets:[
    {label:'Скидки',  data:[factDisc, scenDisc], backgroundColor:'#E74C3C88', borderColor:'#E74C3C', borderWidth:1, borderRadius:2},
    {label:'Фудкост', data:[factFc, scenFc],     backgroundColor:'#F39C1288', borderColor:'#F39C12', borderWidth:1},
    {label:'Маржа',   data:[Math.max(0,factMonth), Math.max(0,scenMonth)], backgroundColor:'#2ECC7188', borderColor:'#2ECC71', borderWidth:1},
  ]}, options:{indexAxis:'y', responsive:true, maintainAspectRatio:false, plugins:{legend:{labels:{color:'#8AAACE',font:{size:9},boxWidth:10}}}, scales:{x:{stacked:true,grid:{color:'rgba(46,64,104,.4)'},ticks:{color:'#4E6A90',font:{size:9},callback:v=>fmtR(v)}}, y:{stacked:true,grid:{color:'rgba(46,64,104,.4)'},ticks:{color:'#4E6A90',font:{size:9}}}}}});
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
