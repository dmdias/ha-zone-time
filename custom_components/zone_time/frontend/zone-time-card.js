/*
 * Zone Time card: how long each person spends in each zone.
 * Author: Daniel Dias (@dmdias) - https://github.com/dmdias/ha-zone-time
 *
 * Served and loaded automatically by the Zone Time integration.
 *
 *   type: custom:zone-time-card
 *   people: [person.ana, person.rui]   # optional, default: every person the integration follows
 *
 * The hours per day and zone come from the integration (kept with no expiry);
 * the day timeline comes from the person history (recorder retention).
 */

const CARD_VERSION = "0.1.0";
const COLORS = ["#5fd3a8", "#3d8bfd", "#f2a541", "#e5484d", "#a78bfa", "#2dd4bf", "#f472b6", "#94a3b8", "#facc15", "#60a5fa"];
const MS_H = 3600000;

const T = {
  pt: { day: "Dia", week: "Semana", month: "Mês", year: "Ano", today: "Hoje", both: "Ambos", total: "Total registado",
    timeline: "Linha do tempo", days: "Por dia", months: "Por mês", loading: "A carregar…", none: "Sem dados neste período.",
    out: "Fora de zonas", unknown: "Sem dados", hint: "Toca numa barra para ver esse período.", week_of: "Semana de" },
  en: { day: "Day", week: "Week", month: "Month", year: "Year", today: "Today", both: "Both", total: "Total tracked",
    timeline: "Timeline", days: "Per day", months: "Per month", loading: "Loading…", none: "No data in this period.",
    out: "Outside zones", unknown: "No data", hint: "Tap a bar to open that period.", week_of: "Week of" },
};

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pad = (n) => String(n).padStart(2, "0");
const slug = (s) => String(s).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const fmtH = (h) => (h >= 10 ? h.toFixed(0) : h.toFixed(1)).replace(".", ",") + " h";
const keyDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

class ZoneTimeCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._period = "day";
    this._anchor = dayStart(new Date());
    this._who = null;
    this._data = null; // last zone_time/data response
    this._timeline = {}; // `${person}|${dayKey}` -> [{zone, from, to}]
  }

  setConfig(config) {
    this._config = config || {};
    this._render();
  }

  static getStubConfig() {
    return {};
  }

  getCardSize() {
    return 10;
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) this._load();
  }

  get _t() {
    const lang = (this._hass?.locale?.language || "en").slice(0, 2);
    return T[lang] || T.en;
  }

  _people() {
    const known = (this._data?.people || []).map((p) => p.entity_id);
    if (Array.isArray(this._config?.people)) return this._config.people.filter((p) => !known.length || known.includes(p));
    return known;
  }

  _personName(p) {
    return this._hass.states[p]?.attributes.friendly_name || (this._data?.people || []).find((x) => x.entity_id === p)?.name || p.split(".")[1];
  }

  /** person state -> zone label */
  _zoneLabel(state) {
    const labels = this._data?.zones || {};
    if (state === "not_home") return this._t.out;
    return labels[state] || state;
  }

  _zones() {
    return Object.keys(this._data?.zones || { home: "Home", not_home: null }).map((k) => this._zoneLabel(k));
  }

  _color(zone) {
    const i = this._zones().indexOf(zone);
    return COLORS[(i < 0 ? this._zones().length : i) % COLORS.length];
  }

  /* ----- periods ----- */

  _range() {
    const a = this._anchor;
    if (this._period === "day") return [a, addDays(a, 1)];
    if (this._period === "week") {
      const start = addDays(a, -((a.getDay() + 6) % 7));
      return [start, addDays(start, 7)];
    }
    if (this._period === "month") return [new Date(a.getFullYear(), a.getMonth(), 1), new Date(a.getFullYear(), a.getMonth() + 1, 1)];
    return [new Date(a.getFullYear(), 0, 1), new Date(a.getFullYear() + 1, 0, 1)];
  }

  _move(step) {
    const a = this._anchor;
    if (this._period === "day") this._anchor = addDays(a, step);
    else if (this._period === "week") this._anchor = addDays(a, 7 * step);
    else if (this._period === "month") this._anchor = new Date(a.getFullYear(), a.getMonth() + step, 1);
    else this._anchor = new Date(a.getFullYear() + step, 0, 1);
    if (this._anchor > new Date()) this._anchor = dayStart(new Date());
    this._load();
  }

  _label() {
    const lang = this._hass?.locale?.language || "en";
    const [s, e] = this._range();
    if (this._period === "day") return s.toLocaleDateString(lang, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    if (this._period === "week") {
      const last = addDays(e, -1);
      return `${s.toLocaleDateString(lang, { day: "numeric", month: "short" })} – ${last.toLocaleDateString(lang, { day: "numeric", month: "short", year: "numeric" })}`;
    }
    if (this._period === "month") return s.toLocaleDateString(lang, { month: "long", year: "numeric" });
    return String(s.getFullYear());
  }

  /* ----- data ----- */

  async _load() {
    if (!this._hass) return;
    const [start, end] = this._range();
    const token = (this._loadToken = Symbol());
    this._loading = true;
    this._render();
    try {
      const data = await this._hass.callWS({ type: "zone_time/data", start: keyDay(start), end: keyDay(end) });
      if (token !== this._loadToken) return;
      this._data = data;
      this._error = null;
      if (!this._who || (this._who !== "both" && !this._people().includes(this._who))) this._who = this._people()[0] || null;
      if (this._period === "day") {
        const people = this._who === "both" ? this._people() : [this._who];
        for (const p of people) if (p) await this._fromHistory(p, start, new Date(Math.min(end, Date.now())));
      }
    } catch (err) {
      this._error = err.message || String(err);
    }
    if (token !== this._loadToken) return;
    this._loading = false;
    this._render();
  }

  async _fromHistory(person, from, to) {
    if (to <= from || from < addDays(dayStart(new Date()), -30)) return;
    try {
      const res = await this._hass.callWS({
        type: "history/history_during_period",
        start_time: new Date(from.getTime() - 2 * 86400000).toISOString(),
        end_time: to.toISOString(),
        entity_ids: [person],
        minimal_response: true,
        no_attributes: true,
        significant_changes_only: false,
      });
      const rows = (res[person] || []).map((r) => ({ s: r.s ?? r.state, t: (r.lu ?? r.lc) ? (r.lu ?? r.lc) * 1000 : Date.parse(r.last_updated || r.last_changed) }));
      rows.sort((a, b) => a.t - b.t);
      const ds = from.getTime();
      const de = to.getTime();
      const segments = [];
      for (let i = 0; i < rows.length; i++) {
        const a = Math.max(rows[i].t, ds);
        const b = Math.min(i + 1 < rows.length ? rows[i + 1].t : Date.now(), de);
        if (b <= a) continue;
        const st = rows[i].s;
        const zone = st === "unknown" || st === "unavailable" ? null : this._zoneLabel(st);
        const last = segments[segments.length - 1];
        if (last && last.zone === zone && last.to === a) last.to = b;
        else segments.push({ zone, from: a, to: b });
      }
      this._timeline[`${person}|${keyDay(from)}`] = segments;
    } catch (err) {
      /* the timeline is optional */
    }
  }

  _sum(person, from, to) {
    const out = {};
    const days = (this._data?.people || []).find((p) => p.entity_id === person)?.days || {};
    for (let d = from; d < to; d = addDays(d, 1)) {
      const h = days[keyDay(d)];
      if (!h) continue;
      for (const [z, v] of Object.entries(h)) {
        const label = this._zoneLabel(z);
        out[label] = (out[label] || 0) + v;
      }
    }
    return out;
  }

  /* ----- rendering ----- */

  _render() {
    if (!this._config) return;
    if (!this._hass) {
      this.shadowRoot.innerHTML = `<style>${STYLES}</style><ha-card><div class="empty">…</div></ha-card>`;
      return;
    }
    const t = this._t;
    if (!this._data) {
      this.shadowRoot.innerHTML = `<style>${STYLES}</style><ha-card><div class="empty">${esc(this._error || t.loading)}</div></ha-card>`;
      return;
    }
    const people = this._people();
    const who = (this._who === "both" ? people : [this._who]).filter(Boolean);
    const seg = (key, label, attr) => `<button data-${attr}="${esc(key)}" class="${(attr === "period" ? this._period : this._who) === key ? "on" : ""}">${esc(label)}</button>`;
    const isToday = this._range()[1] > new Date(); // the current period: nothing after it
    const body = who.map((p) => this._personBlock(p)).join("");
    this.shadowRoot.innerHTML = `<style>${STYLES}</style><ha-card>
      <div class="top">
        <div class="seg">${people.map((p) => seg(p, this._personName(p), "who")).join("")}${people.length > 1 ? seg("both", t.both, "who") : ""}</div>
        <div class="seg">${seg("day", t.day, "period")}${seg("week", t.week, "period")}${seg("month", t.month, "period")}${seg("year", t.year, "period")}</div>
      </div>
      <div class="nav">
        <button data-move="-1">◀</button>
        <span class="label">${esc(this._label().replace(/^./, (c) => c.toUpperCase()))}</span>
        <button data-move="1" ${isToday ? "disabled" : ""}>▶</button>
        <button data-today class="today">${esc(t.today)}</button>
        ${this._loading ? `<span class="muted">${esc(t.loading)}</span>` : ""}
      </div>
      ${this._error ? `<div class="muted">${esc(this._error)}</div>` : ""}
      <div class="people ${who.length > 1 ? "two" : ""}">${body}</div>
    </ha-card>`;
    this._bind();
  }

  _personBlock(person) {
    const t = this._t;
    const [start, end] = this._range();
    const sums = this._sum(person, start, end);
    const zones = Object.entries(sums).filter(([, v]) => v > 0.005).sort((a, b) => b[1] - a[1]);
    const total = zones.reduce((a, [, v]) => a + v, 0);
    const pic = this._hass.states[person]?.attributes.entity_picture;
    const head = `<div class="who">${pic ? `<img src="${esc(pic)}" alt="">` : ""}<b>${esc(this._personName(person))}</b>
      <span class="muted">${esc(t.total)}: ${fmtH(total)}</span></div>`;
    if (!zones.length) return `<div class="block">${head}<div class="empty">${esc(this._loading ? t.loading : t.none)}</div></div>`;
    return `<div class="block">${head}
      <div class="summary">${this._donut(zones, total)}
        <div class="bars">${zones
          .map(([z, v]) => `<div class="row"><span class="dot" style="background:${this._color(z)}"></span><span class="zn">${esc(z)}</span>
            <div class="bar"><i style="width:${(v / zones[0][1]) * 100}%;background:${this._color(z)}"></i></div>
            <span class="hv">${fmtH(v)}</span><span class="pc">${Math.round((v / total) * 100)}%</span></div>`)
          .join("")}</div></div>
      ${this._period === "day" ? this._timelineView(person) : this._trend(person)}
    </div>`;
  }

  _donut(zones, total) {
    const r = 42;
    const c = 2 * Math.PI * r;
    let off = 0;
    const arcs = zones
      .map(([z, v]) => {
        const len = (v / total) * c;
        const s = `<circle r="${r}" cx="60" cy="60" fill="none" stroke="${this._color(z)}" stroke-width="18" stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-off}"><title>${esc(z)}: ${fmtH(v)}</title></circle>`;
        off += len;
        return s;
      })
      .join("");
    return `<svg class="donut" viewBox="0 0 120 120"><g transform="rotate(-90 60 60)">${arcs}</g>
      <text x="60" y="58" text-anchor="middle" class="dt">${fmtH(total)}</text><text x="60" y="74" text-anchor="middle" class="ds">${esc(zones[0][0])}</text></svg>`;
  }

  _timelineView(person) {
    const t = this._t;
    const day = this._range()[0];
    const segs = this._timeline[`${person}|${keyDay(day)}`];
    if (!segs) return "";
    const ds = day.getTime();
    const blocks = segs
      .map((s) => {
        const left = ((s.from - ds) / 86400000) * 100;
        const width = ((s.to - s.from) / 86400000) * 100;
        const when = `${pad(new Date(s.from).getHours())}:${pad(new Date(s.from).getMinutes())}–${pad(new Date(s.to).getHours())}:${pad(new Date(s.to).getMinutes())}`;
        return `<i style="left:${left}%;width:${width}%;background:${s.zone ? this._color(s.zone) : "#3a4254"}"><title></title></i>`.replace(
          "<title></title>",
          `<span class="tip">${esc(s.zone || t.unknown)} · ${when}</span>`
        );
      })
      .join("");
    const ticks = Array.from({ length: 9 }, (_, i) => `<span style="left:${(i * 3 * 100) / 24}%">${pad(i * 3)}h</span>`).join("");
    return `<div class="sub">${esc(t.timeline)}</div><div class="timeline">${blocks}</div><div class="ticks">${ticks}</div>`;
  }

  _trend(person) {
    const t = this._t;
    const [start, end] = this._range();
    const buckets = [];
    if (this._period === "year") {
      for (let m = 0; m < 12; m++) {
        const s = new Date(start.getFullYear(), m, 1);
        buckets.push({ s, e: new Date(start.getFullYear(), m + 1, 1), label: s.toLocaleDateString(this._hass.locale?.language || "en", { month: "narrow" }), go: "month" });
      }
    } else {
      for (let d = start; d < end; d = addDays(d, 1)) buckets.push({ s: d, e: addDays(d, 1), label: this._period === "week" ? d.toLocaleDateString(this._hass.locale?.language || "en", { weekday: "short" }) : String(d.getDate()), go: "day" });
    }
    const data = buckets.map((b) => ({ ...b, sums: this._sum(person, b.s, b.e) }));
    const max = Math.max(1, ...data.map((b) => Object.values(b.sums).reduce((a, v) => a + v, 0)));
    const zones = this._zones();
    const cols = data
      .map((b, i) => {
        const future = b.s > new Date();
        const stack = zones
          .filter((z) => (b.sums[z] || 0) > 0.005)
          .map((z) => `<i style="height:${(b.sums[z] / max) * 100}%;background:${this._color(z)}" title="${esc(z)}: ${fmtH(b.sums[z])}"></i>`)
          .join("");
        const tot = Object.values(b.sums).reduce((a, v) => a + v, 0);
        return `<button class="col ${future ? "future" : ""}" data-go="${b.go}" data-at="${b.s.getTime()}" ${future ? "disabled" : ""} title="${esc(b.label)}: ${fmtH(tot)}">
          <div class="stack">${stack}</div><span>${esc(b.label)}</span></button>`;
      })
      .join("");
    return `<div class="sub">${esc(this._period === "year" ? t.months : t.days)} <span class="muted">· ${esc(t.hint)}</span></div><div class="trend">${cols}</div>`;
  }

  _bind() {
    const root = this.shadowRoot;
    root.querySelectorAll("[data-period]").forEach((b) => (b.onclick = () => ((this._period = b.dataset.period), this._load())));
    root.querySelectorAll("[data-who]").forEach((b) => (b.onclick = () => ((this._who = b.dataset.who), this._load())));
    root.querySelectorAll("[data-move]").forEach((b) => (b.onclick = () => this._move(Number(b.dataset.move))));
    const today = root.querySelector("[data-today]");
    if (today) today.onclick = () => ((this._anchor = dayStart(new Date())), this._load());
    root.querySelectorAll("[data-go]").forEach(
      (b) => (b.onclick = () => ((this._period = b.dataset.go), (this._anchor = new Date(Number(b.dataset.at))), this._load()))
    );
  }
}

const STYLES = `
  :host { --bg:#0d111a; --panel:#1b2130; --panel2:#2a3142; --text:#e8ebf2; --muted:#9aa3b5; display:block; }
  ha-card { background:var(--bg); color:var(--text); border-radius:16px; padding:14px; border:none; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  .top { display:flex; flex-wrap:wrap; gap:10px; justify-content:space-between; }
  .seg { display:inline-flex; background:var(--panel2); border-radius:10px; padding:3px; flex-wrap:wrap; }
  .seg button { background:none; border:1px solid transparent; color:var(--muted); padding:6px 14px; border-radius:8px; cursor:pointer; font:inherit; font-size:14px; }
  .seg button.on { color:var(--text); background:#3a4359; border-color:#6fd8c0; }
  .nav { display:flex; align-items:center; gap:8px; margin:12px 0; flex-wrap:wrap; }
  .nav button { background:var(--panel2); color:var(--text); border:none; border-radius:8px; padding:6px 12px; cursor:pointer; font:inherit; }
  .nav button[disabled] { opacity:.35; cursor:default; }
  .nav .label { font-size:16px; font-weight:600; min-width:200px; text-align:center; }
  .nav .today { margin-left:4px; }
  .muted { color:var(--muted); font-size:12px; }
  .empty { color:var(--muted); padding:24px; text-align:center; }
  .people { display:grid; gap:12px; }
  .people.two { grid-template-columns:repeat(auto-fit, minmax(380px, 1fr)); }
  .block { background:var(--panel); border-radius:14px; padding:12px 14px; }
  .who { display:flex; align-items:center; gap:10px; margin-bottom:8px; }
  .who img { width:34px; height:34px; border-radius:50%; object-fit:cover; }
  .who b { font-size:16px; } .who .muted { margin-left:auto; }
  .summary { display:flex; gap:16px; align-items:center; flex-wrap:wrap; }
  .donut { width:130px; height:130px; flex:none; }
  .dt { fill:var(--text); font-size:15px; font-weight:700; } .ds { fill:var(--muted); font-size:9px; }
  .bars { flex:1; min-width:220px; display:flex; flex-direction:column; gap:7px; }
  .row { display:grid; grid-template-columns:10px minmax(80px,140px) 1fr 52px 38px; gap:8px; align-items:center; font-size:13px; }
  .dot { width:10px; height:10px; border-radius:50%; }
  .zn { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .bar { height:10px; background:var(--panel2); border-radius:5px; overflow:hidden; } .bar i { display:block; height:100%; border-radius:5px; }
  .hv { text-align:right; font-weight:600; } .pc { text-align:right; color:var(--muted); }
  .sub { margin:14px 0 6px; font-size:13px; font-weight:600; }
  .timeline { position:relative; height:26px; background:var(--panel2); border-radius:6px; overflow:visible; }
  .timeline i { position:absolute; top:0; bottom:0; border-radius:3px; }
  .timeline i .tip { display:none; position:absolute; bottom:30px; left:0; background:#000d; color:#fff; font-size:11px; padding:2px 6px; border-radius:4px; white-space:nowrap; font-style:normal; z-index:2; }
  .timeline i:hover .tip { display:block; }
  .ticks { position:relative; height:16px; font-size:10px; color:var(--muted); }
  .ticks span { position:absolute; transform:translateX(-50%); top:2px; } .ticks span:first-child { transform:none; }
  .trend { display:flex; align-items:flex-end; gap:3px; height:150px; }
  .col { flex:1; min-width:0; height:100%; display:flex; flex-direction:column; justify-content:flex-end; align-items:stretch; background:none; border:none; padding:0; cursor:pointer; color:var(--muted); font:inherit; }
  .col .stack { flex:1; display:flex; flex-direction:column-reverse; justify-content:flex-start; border-radius:4px; overflow:hidden; }
  .col .stack i { display:block; width:100%; }
  .col span { font-size:10px; text-align:center; margin-top:3px; white-space:nowrap; overflow:hidden; }
  .col:hover .stack { outline:2px solid #6fd8c0; outline-offset:1px; }
  .col.future { opacity:.3; cursor:default; }
  @media (max-width: 600px) { .people.two { grid-template-columns:1fr; } .row { grid-template-columns:10px minmax(70px,1fr) 1fr 46px 32px; } .nav .label { min-width:0; flex:1; } }
`;

if (!customElements.get("zone-time-card")) {
  customElements.define("zone-time-card", ZoneTimeCard);
  window.customCards = window.customCards || [];
  window.customCards.push({ type: "zone-time-card", name: "Zone Time", description: "Time each person spends in each zone, per day, week, month and year", documentationURL: "https://github.com/dmdias/ha-zone-time" });
}
console.info(`%c ZONE-TIME-CARD %c ${CARD_VERSION} `, "background:#5fd3a8;color:#000", "background:#1b2130;color:#fff");
